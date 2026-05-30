export type CodeEntityType = 'function';

export type CodeEntityDraft = {
  type: CodeEntityType;
  file_path: string;
  name: string | null;
  line_start: number;
  line_end: number;
  signature: string | null;
  metadata: string | null;
};
