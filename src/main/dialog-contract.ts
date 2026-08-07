export interface SaveDialogLikeResult {
  canceled: boolean;
  filePath?: string;
}

export interface SaveFileResult {
  canceled: boolean;
  filePath: string | null;
}

export function toSaveFileResult(result: SaveDialogLikeResult): SaveFileResult {
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: null };
  }
  return { canceled: false, filePath: result.filePath };
}
