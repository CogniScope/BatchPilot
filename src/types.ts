export interface Column {
  id: string;
  name: string;
}

export interface OutputColumn {
  id: string;
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
}

export interface AgentTask {
  id: string;
  rowId: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: Record<string, string>;
  error?: string;
}

export interface FilterRule {
  id: string;
  column: string;
  columnType: 'input' | 'output';
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value: string;
}

export interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}
