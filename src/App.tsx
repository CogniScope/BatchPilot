import React, { useState, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import { Play, Download, Plus, Trash2, AlertCircle, Loader2, X, Activity, FileSpreadsheet, Sparkles, Wand2, Search, Filter, Info, Square, Eye, Pencil } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CsvData, OutputColumn, AgentTask, FilterRule } from './types';
import { processRowWithGemini, generateOutputColumnsFromPrompt, improvePromptWithGemini } from './lib/gemini';

const DEFAULT_WIDTHS: Record<string, number> = {
  __checkbox: 40,
  __row: 60,
  __status: 120,
  __actions: 120,
};

const LS_KEY = 'batch-llm-processor-column-widths';

export default function App() {
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [selectedInputColumns, setSelectedInputColumns] = useState<string[]>([]);
  const [outputColumns, setOutputColumns] = useState<OutputColumn[]>([
    { id: '1', name: 'technological_stack', description: 'Find CRM and Marketing tools used', type: 'string' }
  ]);
  const [prompt, setPrompt] = useState<string>('Research the company website and identify the primary CRM and Marketing Automation tools they currently utilize. If not found, look for LinkedIn hiring posts for clues.');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isGeneratingColumns, setIsGeneratingColumns] = useState(false);
  const [isImprovingPrompt, setIsImprovingPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editingColumnName, setEditingColumnName] = useState<string>('');
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const colW = (key: string): number => columnWidths[key] ?? DEFAULT_WIDTHS[key] ?? 200;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const isHaltedRef = useRef(false);

  const filteredIndices = useMemo(() => {
    if (!csvData) return [];
    return csvData.rows
      .map((_, index) => index)
      .filter(index => {
        const row = csvData.rows[index];
        const task = tasks.find(t => t.rowId === index);
        
        if (statusFilter !== 'all') {
          const currentStatus = task ? task.status : 'pending';
          if (currentStatus !== statusFilter) return false;
        }

        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const inMatch = selectedInputColumns.some(col => String(row[col] || '').toLowerCase().includes(query));
          const outMatch = task?.result ? outputColumns.some(col => String(task.result![col.name] || '').toLowerCase().includes(query)) : false;
          if (!inMatch && !outMatch) return false;
        }

        // Advanced filter rules
        for (const rule of filterRules) {
          let cellValue = '';
          if (rule.columnType === 'input') {
            cellValue = String(row[rule.column] || '');
          } else {
            cellValue = String(task?.result?.[rule.column] || '');
          }

          const cellLower = cellValue.toLowerCase();
          const valLower = rule.value.toLowerCase();

          switch (rule.operator) {
            case 'contains':
              if (!cellLower.includes(valLower)) return false;
              break;
            case 'equals':
              if (cellLower !== valLower) return false;
              break;
            case 'starts_with':
              if (!cellLower.startsWith(valLower)) return false;
              break;
            case 'ends_with':
              if (!cellLower.endsWith(valLower)) return false;
              break;
            case 'greater_than':
              if (!isNaN(Number(cellValue)) && !isNaN(Number(rule.value)) && rule.value.trim() !== '') {
                if (Number(cellValue) <= Number(rule.value)) return false;
              } else {
                if (cellValue <= rule.value) return false;
              }
              break;
            case 'less_than':
              if (!isNaN(Number(cellValue)) && !isNaN(Number(rule.value)) && rule.value.trim() !== '') {
                if (Number(cellValue) >= Number(rule.value)) return false;
              } else {
                if (cellValue >= rule.value) return false;
              }
              break;
            case 'is_empty':
              if (cellValue.trim() !== '') return false;
              break;
            case 'is_not_empty':
              if (cellValue.trim() === '') return false;
              break;
          }
        }

        return true;
      });
  }, [csvData, tasks, searchQuery, statusFilter, selectedInputColumns, outputColumns, filterRules]);

  const rowVirtualizer = useVirtualizer({
    count: filteredIndices.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 49, // Approximate row height in pixels
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]?.start || 0 : 0;
  const paddingBottom = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end || 0)
    : 0;

  const visibleInputColumns = selectedInputColumns.filter(c => !hiddenColumns.has(c));
  const visibleOutputColumns = outputColumns.filter(c => !hiddenColumns.has(c.name));
  const totalColumns = visibleInputColumns.length + visibleOutputColumns.length + 4;

  const effectiveIndices = useMemo(() => {
    if (selectedRows.size === 0) return filteredIndices;
    const filteredSet = new Set(filteredIndices);
    return Array.from(selectedRows).filter(i => filteredSet.has(i));
  }, [selectedRows, filteredIndices]);

  const toggleColumnVisibility = (colName: string) => {
    setHiddenColumns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(colName)) {
        newSet.delete(colName);
      } else {
        newSet.add(colName);
      }
      return newSet;
    });
  };

  const addFilterRule = () => {
    const defaultCol = selectedInputColumns.length > 0 ? selectedInputColumns[0] : '';
    setFilterRules(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        column: defaultCol,
        columnType: 'input',
        operator: 'contains',
        value: ''
      }
    ]);
  };

  const updateFilterRule = (id: string, field: keyof FilterRule, value: string) => {
    setFilterRules(prev => prev.map(rule => rule.id === id ? { ...rule, [field]: value } : rule));
  };

  const removeFilterRule = (id: string) => {
    setFilterRules(prev => prev.filter(rule => rule.id !== id));
  };

  const handleImprovePrompt = async () => {
    if (!prompt) {
      setError("Please provide an initial Agent Instruction to improve.");
      return;
    }
    setIsImprovingPrompt(true);
    setError(null);
    try {
      const improved = await improvePromptWithGemini(prompt, selectedModel);
      if (improved) {
        setPrompt(improved);
      }
    } catch (err: any) {
      setError(`Failed to improve prompt: ${err.message}`);
    } finally {
      setIsImprovingPrompt(false);
    }
  };

  const handleGenerateColumns = async () => {
    if (!prompt) {
      setError("Please provide an Agent Instruction first.");
      return;
    }
    setIsGeneratingColumns(true);
    setError(null);
    try {
      const generated = await generateOutputColumnsFromPrompt(prompt, selectedModel);
      if (generated.length > 0) {
        setOutputColumns(generated);
      }
    } catch (err: any) {
      setError(`Failed to generate columns: ${err.message}`);
    } finally {
      setIsGeneratingColumns(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setError("Please upload a valid CSV file.");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(`Error parsing CSV: ${results.errors[0].message}`);
          return;
        }
        
        const headers = results.meta.fields || [];
        if (headers.length === 0) {
          setError("CSV file must have a header row.");
          return;
        }

        const data = results.data as Record<string, string>[];
        if (data.length === 0) {
          setError("CSV file contains no data rows.");
          return;
        }

        setCsvData({
          headers,
          rows: data,
        });
        setSelectedInputColumns(headers); // Select all by default
        setError(null);
        setTasks([]);
      },
      error: (err: any) => {
        setError(`Failed to read file: ${err.message}`);
      }
    });

    // Reset input so the same file can be uploaded again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clearSelectedInputColumns = () => {
    setSelectedInputColumns([]);
  };

  const saveColumnRename = (oldName: string) => {
    const newName = editingColumnName.trim();
    if (!newName || newName === oldName) {
      setEditingColumn(null);
      return;
    }
    if (csvData?.headers.includes(newName)) {
      setError(`A column named "${newName}" already exists.`);
      setEditingColumn(null);
      return;
    }

    setCsvData(prev => {
      if (!prev) return prev;
      const newHeaders = prev.headers.map(h => h === oldName ? newName : h);
      const newRows = prev.rows.map(row => {
        const newRow = { ...row };
        newRow[newName] = newRow[oldName];
        delete newRow[oldName];
        return newRow;
      });
      return { headers: newHeaders, rows: newRows };
    });

    setSelectedInputColumns(prev => prev.map(c => c === oldName ? newName : c));
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(oldName)) {
        next.delete(oldName);
        next.add(newName);
      }
      return next;
    });
    setFilterRules(prev => prev.map(rule => 
      (rule.columnType === 'input' && rule.column === oldName) 
        ? { ...rule, column: newName } 
        : rule
    ));

    setEditingColumn(null);
    setError(null);
  };

  const addOutputColumn = () => {
    setOutputColumns(prev => [
      ...prev, 
      { id: Date.now().toString(), name: `column_${prev.length + 1}`, description: '', type: 'string' }
    ]);
  };

  const updateOutputColumn = (id: string, field: keyof OutputColumn, value: string) => {
    setOutputColumns(prev => prev.map(col => col.id === id ? { ...col, [field]: value } : col));
  };

  const removeOutputColumn = (id: string) => {
    setOutputColumns(prev => prev.filter(col => col.id !== id));
  };

  const startProcessing = async () => {
    if (!csvData || selectedInputColumns.length === 0 || outputColumns.length === 0 || !prompt) {
      setError("Please ensure CSV is loaded, columns are selected, and prompt is provided.");
      return;
    }

    if (effectiveIndices.length === 0) {
      setError("No rows match the current filters or selection to process.");
      return;
    }

    setIsProcessing(true);
    setIsStopping(false);
    isHaltedRef.current = false;
    setError(null);

    // Initialize or update tasks for filtered rows
    setTasks(prev => {
      const newTasks = [...prev];
      // Ensure all rows have a task entry if not exists
      csvData.rows.forEach((_, index) => {
        if (!newTasks.find(t => t.rowId === index)) {
          newTasks.push({ id: `task_${index}`, rowId: index, status: 'pending' });
        }
      });
      // Set filtered rows to pending
      effectiveIndices.forEach(index => {
        const taskIndex = newTasks.findIndex(t => t.rowId === index);
        if (taskIndex !== -1) {
          newTasks[taskIndex] = { ...newTasks[taskIndex], status: 'pending', error: undefined };
        }
      });
      return newTasks;
    });

    // Process in parallel with a concurrency limit
    const concurrencyLimit = 25;
    let currentIndex = 0;
    const indicesToProcess = [...effectiveIndices];

    const processNext = async (): Promise<void> => {
      if (isHaltedRef.current || currentIndex >= indicesToProcess.length) return;
      
      const taskIndex = indicesToProcess[currentIndex++];
      const row = csvData.rows[taskIndex];
      
      setTasks(prev => prev.map(t => t.rowId === taskIndex ? { ...t, status: 'running' } : t));

      try {
        const result = await processRowWithGemini(row, prompt, selectedInputColumns, outputColumns, selectedModel);
        setTasks(prev => prev.map(t => t.rowId === taskIndex ? { ...t, status: 'completed', result } : t));
      } catch (err: any) {
        setTasks(prev => prev.map(t => t.rowId === taskIndex ? { ...t, status: 'error', error: err.message } : t));
      }

      await processNext();
    };

    const workers = Array.from({ length: Math.min(concurrencyLimit, indicesToProcess.length) }).map(() => processNext());
    await Promise.all(workers);

    setIsProcessing(false);
    setIsStopping(false);
  };

  const stopProcessing = () => {
    isHaltedRef.current = true;
    setIsStopping(true);
  };

  const runSingleRow = async (rowIndex: number) => {
    if (!csvData || selectedInputColumns.length === 0 || outputColumns.length === 0 || !prompt) {
      setError("Please ensure CSV is loaded, columns are selected, and prompt is provided.");
      return;
    }

    const row = csvData.rows[rowIndex];
    
    setTasks(prev => {
      const newTasks = [...prev];
      const taskIndex = newTasks.findIndex(t => t.rowId === rowIndex);
      if (taskIndex !== -1) {
        newTasks[taskIndex] = { ...newTasks[taskIndex], status: 'running', error: undefined };
      } else {
        newTasks.push({ id: `task_${rowIndex}`, rowId: rowIndex, status: 'running' });
      }
      return newTasks;
    });

    try {
      const result = await processRowWithGemini(row, prompt, selectedInputColumns, outputColumns, selectedModel);
      setTasks(prev => prev.map(t => t.rowId === rowIndex ? { ...t, status: 'completed', result } : t));
    } catch (err: any) {
      setTasks(prev => prev.map(t => t.rowId === rowIndex ? { ...t, status: 'error', error: err.message } : t));
    }
  };

  const exportSingleRow = (rowIndex: number) => {
    if (!csvData) return;

    const outputHeaders = outputColumns.map(c => c.name);
    const allHeaders = [...csvData.headers, ...outputHeaders];

    const row = csvData.rows[rowIndex];
    const task = tasks.find(t => t.rowId === rowIndex);
    const resultData = task?.result || {};
    
    const newRow: Record<string, string> = { ...row };
    outputHeaders.forEach(header => {
      newRow[header] = resultData[header] || (task?.status === 'error' ? 'ERROR' : '');
    });

    const csv = Papa.unparse({
      fields: allHeaders,
      data: [newRow]
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `row_${rowIndex + 1}_export.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const deleteSingleRow = (rowIndex: number) => {
    if (!csvData) return;
    
    setCsvData(prev => {
      if (!prev) return prev;
      const newRows = [...prev.rows];
      newRows.splice(rowIndex, 1);
      return { ...prev, rows: newRows };
    });

    setTasks(prev => {
      return prev
        .filter(t => t.rowId !== rowIndex)
        .map(t => t.rowId > rowIndex ? { ...t, rowId: t.rowId - 1 } : t);
    });

    setSelectedRows(prev => {
      const newSet = new Set<number>();
      prev.forEach(id => {
        if (id < rowIndex) newSet.add(id);
        if (id > rowIndex) newSet.add(id - 1);
      });
      return newSet;
    });
  };

  const downloadResults = () => {
    if (!csvData || tasks.length === 0) return;

    const outputHeaders = outputColumns.map(c => c.name);
    const allHeaders = [...csvData.headers, ...outputHeaders];

    const dataToExport = effectiveIndices.map(index => {
      const row = csvData.rows[index];
      const task = tasks.find(t => t.rowId === index);
      const resultData = task?.result || {};
      
      const newRow: Record<string, string> = { ...row };
      outputHeaders.forEach(header => {
        newRow[header] = resultData[header] || (task?.status === 'error' ? 'ERROR' : '');
      });
      return newRow;
    });

    const csv = Papa.unparse({
      fields: allHeaders,
      data: dataToExport
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'analysis_results.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const completedCount = tasks.filter(t => t.status === 'completed' || t.status === 'error').length;
  const progress = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
  const activeWorkersCount = tasks.filter(t => t.status === 'running').length;

  return (
    <>
      <header>
        <div className="logo">
          <Activity className="w-5 h-5" />
          Batch LLM Processor
        </div>
      </header>

      <main>
        <aside>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md flex items-start gap-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <div>
            <div className="section-title">Source Data</div>
            {!csvData ? (
              <div className="upload-box" onClick={() => fileInputRef.current?.click()}>
                <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-[var(--text-secondary)] opacity-50" />
                <span><strong>Click to upload CSV</strong></span><br />
                <span style={{ fontSize: '0.75rem' }}>or drag and drop</span>
              </div>
            ) : (
              <div className="upload-box" style={{ background: '#EEF2FF', borderColor: 'var(--accent)' }}>
                <span><strong>Data Loaded</strong></span><br />
                <span style={{ fontSize: '0.75rem' }}>{csvData.rows.length} rows uploaded</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); setCsvData(null); setTasks([]); }}
                  className="mt-2 text-xs text-[var(--accent)] hover:underline"
                  disabled={isProcessing}
                >
                  Clear Data
                </button>
              </div>
            )}
            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          </div>

          <div className="form-group">
            <div className="flex justify-between items-center mb-1">
              <div className="section-title" style={{ marginBottom: 0 }}>Configuration</div>
            </div>
            <div className="flex justify-between items-center">
              <label className="flex items-center gap-1">
                Input Columns 
                <div className="tooltip-container">
                  <Info className="w-3 h-3 text-gray-400 cursor-help" />
                  <span className="tooltip-text">Select the columns from your CSV that the AI should read to perform the analysis. Hold Ctrl/Cmd to select multiple.</span>
                </div>
              </label>
              <button 
                onClick={clearSelectedInputColumns}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]"
              >
                Clear Selected
              </button>
            </div>
            <div className="border border-[var(--border)] rounded-md overflow-y-auto bg-white" style={{ height: '150px' }}>
              {!csvData && <div className="p-3 text-sm text-gray-400 italic">Upload CSV first...</div>}
              {csvData?.headers.map(header => (
                <div key={header} className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] last:border-0 hover:bg-gray-50 group">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input 
                      type="checkbox" 
                      checked={selectedInputColumns.includes(header)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedInputColumns(prev => [...prev, header]);
                        } else {
                          setSelectedInputColumns(prev => prev.filter(c => c !== header));
                        }
                      }}
                      disabled={isProcessing}
                    />
                    {editingColumn === header ? (
                      <input 
                        type="text" 
                        value={editingColumnName}
                        onChange={(e) => setEditingColumnName(e.target.value)}
                        onBlur={() => saveColumnRename(header)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveColumnRename(header); if (e.key === 'Escape') setEditingColumn(null); }}
                        autoFocus
                        className="flex-1 text-sm border border-[var(--accent)] rounded px-1 py-0.5 outline-none"
                        disabled={isProcessing}
                      />
                    ) : (
                      <span className="text-sm truncate" title={header}>{header}</span>
                    )}
                  </div>
                  {!isProcessing && editingColumn !== header && (
                    <button 
                      onClick={() => { setEditingColumn(header); setEditingColumnName(header); }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-[var(--accent)] p-1"
                      title="Rename column"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <div className="flex justify-between items-center mb-1">
              <label className="flex items-center gap-1" style={{ marginBottom: 0 }}>
                Agent Instruction
                <div className="tooltip-container">
                  <Info className="w-3 h-3 text-gray-400 cursor-help" />
                  <span className="tooltip-text">Provide clear instructions on what the AI should do with the input data. You can use the Improve button to let AI refine your prompt.</span>
                </div>
              </label>
              <button 
                onClick={handleImprovePrompt} 
                className="text-xs text-[var(--accent)] flex items-center gap-1 hover:opacity-70"
                disabled={isImprovingPrompt || isProcessing}
              >
                {isImprovingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} Improve
              </button>
            </div>
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Instructions for the AI agent..."
              disabled={isProcessing}
            />
          </div>

          <div className="form-group">
            <div className="flex justify-between items-center">
              <label className="flex items-center gap-1">
                Output Columns
                <div className="tooltip-container">
                  <Info className="w-3 h-3 text-gray-400 cursor-help" />
                  <span className="tooltip-text">Define the columns you want the AI to generate. The AI will extract or deduce this information from the input data.</span>
                </div>
              </label>
              <div className="flex gap-2">
                <button 
                  onClick={handleGenerateColumns} 
                  className="text-xs text-[var(--accent)] flex items-center gap-1 hover:opacity-70"
                  disabled={isGeneratingColumns || isProcessing}
                >
                  {isGeneratingColumns ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Generate
                </button>
                <button onClick={addOutputColumn} className="text-xs text-[var(--accent)] flex items-center gap-1 hover:opacity-70">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>
            {outputColumns.map((col) => (
              <div key={col.id} className="flex flex-col gap-2 p-2 border border-[var(--border)] rounded-md bg-[#FAFAFA] relative">
                <div className="flex gap-2 items-center pr-6">
                  <input 
                    type="text" 
                    value={col.name}
                    onChange={(e) => updateOutputColumn(col.id, 'name', e.target.value)}
                    placeholder="Column name..."
                    disabled={isProcessing}
                    className="flex-1 min-w-0"
                  />
                  <select
                    value={col.type}
                    onChange={(e) => updateOutputColumn(col.id, 'type', e.target.value as OutputColumn['type'])}
                    disabled={isProcessing}
                    className="w-24 text-xs shrink-0"
                    title="Data Type"
                  >
                    <option value="string">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">True/False</option>
                  </select>
                </div>
                <input 
                  type="text" 
                  value={col.description}
                  onChange={(e) => updateOutputColumn(col.id, 'description', e.target.value)}
                  placeholder="Description (e.g. Find CRM used)" 
                  style={{ fontSize: '0.75rem', color: '#666' }}
                  disabled={isProcessing}
                />
                <button 
                  onClick={() => removeOutputColumn(col.id)}
                  className="absolute top-2 right-2 text-red-500 hover:opacity-70 p-1 bg-[#FAFAFA] rounded-full"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="form-group">
            <label className="flex items-center gap-1">
              Model Selector
              <div className="tooltip-container">
                <Info className="w-3 h-3 text-gray-400 cursor-help" />
                <span className="tooltip-text">Choose the AI model. Pro is better for complex reasoning, Flash is faster and more cost-effective.</span>
              </div>
            </label>
            <select 
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isProcessing}
            >
              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Best Reasoning)</option>
              <option value="gemini-3-flash-preview">Gemini 3.0 Flash</option>
              <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Faster)</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            </select>
          </div>

          {isProcessing ? (
            <button 
              className="btn-primary"
              onClick={stopProcessing}
              disabled={isStopping}
              style={{ backgroundColor: isStopping ? '#F59E0B' : '#EF4444' }}
            >
              {isStopping ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Stopping...</>
              ) : (
                <><Square className="w-4 h-4 fill-current" /> Stop Processing</>
              )}
            </button>
          ) : (
            <button 
              className="btn-primary"
              onClick={startProcessing}
              disabled={!csvData || selectedInputColumns.length === 0 || outputColumns.length === 0}
            >
              <Play className="w-4 h-4" /> Execute Analysis ({effectiveIndices.length})
            </button>
          )}
        </aside>

        <div className="content">
          <div className="status-panel">
            <div className="progress-header">
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Processing Queue</h2>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Parallel Workers: {activeWorkersCount} active
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 600 }}>{Math.round(progress)}%</span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {completedCount} / {tasks.length || 0} records
                </div>
              </div>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>

          <div className="table-container">
            <div className="table-header flex-col items-start gap-4 md:flex-row md:items-center">
              <div className="flex items-center justify-between w-full md:w-auto">
                <h3>Live Output Preview</h3>
                <span className="text-xs text-[var(--text-secondary)] ml-2 bg-gray-100 px-2 py-1 rounded-full">
                  {filteredIndices.length} rows
                </span>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-48">
                  <Search className="w-4 h-4 absolute left-2.5 top-2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search data..." 
                    className="input-field pl-8 py-1.5 text-sm w-full"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <select 
                  className="input-field py-1.5 text-sm w-32"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="error">Error</option>
                </select>
                <button 
                  className={`btn-secondary ${showFilters ? 'bg-gray-100' : ''}`}
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <Filter className="w-3 h-3" /> Filters {filterRules.length > 0 && `(${filterRules.length})`}
                </button>
                
                <div className="relative">
                  <button 
                    className={`btn-secondary ${showColumnMenu ? 'bg-gray-100' : ''}`}
                    style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                    onClick={() => setShowColumnMenu(!showColumnMenu)}
                  >
                    <Eye className="w-3 h-3" /> Columns
                  </button>
                  {showColumnMenu && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setShowColumnMenu(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-[var(--border)] rounded-md shadow-lg z-50 py-1 max-h-96 overflow-y-auto">
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50">Input Columns</div>
                        {selectedInputColumns.map(col => (
                          <label key={`menu_in_${col}`} className="flex items-center px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="mr-2"
                              checked={!hiddenColumns.has(col)}
                              onChange={() => toggleColumnVisibility(col)}
                            />
                            <span className="truncate">{col}</span>
                          </label>
                        ))}
                        {selectedInputColumns.length === 0 && <div className="px-3 py-1 text-xs text-gray-400">None selected</div>}
                        
                        <div className="px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 mt-1 border-t border-gray-100">Output Columns</div>
                        {outputColumns.map(col => (
                          <label key={`menu_out_${col.name}`} className="flex items-center px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="mr-2"
                              checked={!hiddenColumns.has(col.name)}
                              onChange={() => toggleColumnVisibility(col.name)}
                            />
                            <span className="truncate">{col.name}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <button 
                  className="btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                  onClick={downloadResults}
                  disabled={tasks.length === 0 || effectiveIndices.length === 0}
                >
                  <Download className="w-3 h-3" /> Export {selectedRows.size > 0 ? `(${effectiveIndices.length})` : ''}
                </button>
              </div>
            </div>
            
            {showFilters && (
              <div className="p-4 border-b border-[var(--border)] bg-gray-50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-gray-700">Advanced Filters</h4>
                  <button onClick={() => setFilterRules([])} className="text-xs text-[var(--accent)] hover:underline">Clear All</button>
                </div>
                {filterRules.length === 0 && (
                  <div className="text-xs text-gray-500 italic">No advanced filters applied.</div>
                )}
                {filterRules.map(rule => (
                  <div key={rule.id} className="flex flex-wrap items-center gap-2">
                    <select 
                      className="input-field py-1 px-2 text-xs w-40"
                      value={`${rule.columnType}:${rule.column}`}
                      onChange={e => {
                        const colonIndex = e.target.value.indexOf(':');
                        const type = e.target.value.slice(0, colonIndex);
                        const col = e.target.value.slice(colonIndex + 1);
                        updateFilterRule(rule.id, 'columnType', type as 'input' | 'output');
                        updateFilterRule(rule.id, 'column', col);
                      }}
                    >
                      <optgroup label="Input Columns">
                        {selectedInputColumns.map(col => <option key={`in_${col}`} value={`input:${col}`}>{col}</option>)}
                      </optgroup>
                      <optgroup label="Output Columns">
                        {outputColumns.map(col => <option key={`out_${col.name}`} value={`output:${col.name}`}>{col.name}</option>)}
                      </optgroup>
                    </select>
                    <select
                      className="input-field py-1 px-2 text-xs w-32"
                      value={rule.operator}
                      onChange={e => updateFilterRule(rule.id, 'operator', e.target.value)}
                    >
                      <option value="contains">Contains</option>
                      <option value="equals">Equals</option>
                      <option value="starts_with">Starts with</option>
                      <option value="ends_with">Ends with</option>
                      <option value="greater_than">Greater than</option>
                      <option value="less_than">Less than</option>
                      <option value="is_empty">Is empty</option>
                      <option value="is_not_empty">Is not empty</option>
                    </select>
                    {rule.operator !== 'is_empty' && rule.operator !== 'is_not_empty' && (
                      <input 
                        type="text" 
                        className="input-field py-1 px-2 text-xs flex-1 min-w-[150px]"
                        placeholder="Value..."
                        value={rule.value}
                        onChange={e => updateFilterRule(rule.id, 'value', e.target.value)}
                      />
                    )}
                    <button onClick={() => removeFilterRule(rule.id)} className="text-red-500 hover:opacity-70 p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button 
                  onClick={addFilterRule}
                  className="text-xs text-[var(--accent)] flex items-center gap-1 hover:opacity-70 self-start mt-1"
                >
                  <Plus className="w-3 h-3" /> Add Rule
                </button>
              </div>
            )}

            <div className="table-wrapper" ref={tableContainerRef}>
              <table>
                <thead>
                  <tr>
                    <th className="sticky-col-header" style={{ left: 0, width: '40px', textAlign: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={filteredIndices.length > 0 && filteredIndices.every(i => selectedRows.has(i))}
                        ref={input => {
                          if (input) {
                            input.indeterminate = selectedRows.size > 0 && !filteredIndices.every(i => selectedRows.has(i));
                          }
                        }}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const newSet = new Set(selectedRows);
                            filteredIndices.forEach(i => newSet.add(i));
                            setSelectedRows(newSet);
                          } else {
                            const newSet = new Set(selectedRows);
                            filteredIndices.forEach(i => newSet.delete(i));
                            setSelectedRows(newSet);
                          }
                        }}
                      />
                    </th>
                    <th className="sticky-col-header" style={{ left: '40px', width: '60px' }}>Row</th>
                    <th className="sticky-col-header" style={{ left: '100px', width: '120px' }}>Status</th>
                    <th className="sticky-col-header sticky-col-divider" style={{ left: '220px', width: '120px', textAlign: 'center' }}>Actions</th>
                    {visibleInputColumns.map(header => (
                      <th key={`in_${header}`}>[IN] {header}</th>
                    ))}
                    {visibleOutputColumns.map(col => (
                      <th key={`out_${col.id}`}>[OUT] {col.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!csvData && (
                    <tr>
                      <td colSpan={totalColumns} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
                        Upload a CSV file to see preview
                      </td>
                    </tr>
                  )}
                  {csvData && filteredIndices.length === 0 && (
                    <tr>
                      <td colSpan={totalColumns} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
                        No rows match the current filters.
                      </td>
                    </tr>
                  )}
                  {paddingTop > 0 && (
                    <tr>
                      <td colSpan={totalColumns} style={{ height: `${paddingTop}px`, padding: 0, border: 'none' }} />
                    </tr>
                  )}
                  {virtualItems.map((virtualRow) => {
                    const rowIndex = filteredIndices[virtualRow.index];
                    const row = csvData!.rows[rowIndex];
                    const task = tasks.find(t => t.rowId === rowIndex);
                    const isRunning = task?.status === 'running';
                    
                    return (
                      <tr 
                        key={virtualRow.key} 
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        style={{ background: isRunning ? '#F9FAFB' : 'white' }}
                        className="group"
                      >
                        <td className="sticky-col-cell" style={{ left: 0, textAlign: 'center' }}>
                          <input 
                            type="checkbox"
                            checked={selectedRows.has(rowIndex)}
                            onChange={(e) => {
                              const newSet = new Set(selectedRows);
                              if (e.target.checked) {
                                newSet.add(rowIndex);
                              } else {
                                newSet.delete(rowIndex);
                              }
                              setSelectedRows(newSet);
                            }}
                          />
                        </td>
                        <td className="sticky-col-cell" style={{ left: '40px', color: 'var(--text-secondary)' }}>{rowIndex + 1}</td>
                        <td className="sticky-col-cell" style={{ left: '100px' }}>
                          {!task || task.status === 'pending' ? (
                            <div className="status-badge status-pending" title="Waiting to be processed">
                              <div className="dot dot-pending"></div>Pending
                            </div>
                          ) : task.status === 'running' ? (
                            <div className="status-badge status-active" title="Currently being processed by the AI">
                              <div className="dot dot-active"></div>Active
                            </div>
                          ) : task.status === 'completed' ? (
                            <div className="status-badge status-success" title="Successfully processed and data extracted">
                              <div className="dot dot-success"></div>Success
                            </div>
                          ) : (
                            <div className="status-badge status-error" title={`Error: ${task.error}`}>
                              <div className="dot dot-error"></div>Error
                            </div>
                          )}
                        </td>
                        <td className="sticky-col-cell sticky-col-divider" style={{ left: '220px', textAlign: 'center' }}>
                          <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => runSingleRow(rowIndex)} 
                              className="p-1 text-[var(--accent)] hover:bg-blue-50 rounded"
                              title="Run this row"
                              disabled={isRunning}
                            >
                              <Play className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => exportSingleRow(rowIndex)} 
                              className="p-1 text-gray-600 hover:bg-gray-100 rounded"
                              title="Export this row"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => deleteSingleRow(rowIndex)} 
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
                              title="Delete this row"
                              disabled={isRunning}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                        {visibleInputColumns.map(header => (
                          <td key={`in_${header}_${rowIndex}`} title={row[header]}>
                            <span className="tag">{row[header]}</span>
                          </td>
                        ))}
                        {visibleOutputColumns.map(col => {
                          const cellValue = isRunning ? `Processing row ${rowIndex + 1}...` : (task?.result?.[col.name] || (task?.status === 'error' ? 'ERROR' : '-'));
                          return (
                            <td key={`out_${col.id}_${rowIndex}`} style={{ color: isRunning ? '#999' : 'inherit', fontStyle: isRunning ? 'italic' : 'normal' }} title={cellValue}>
                              {cellValue}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr>
                      <td colSpan={totalColumns} style={{ height: `${paddingBottom}px`, padding: 0, border: 'none' }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

