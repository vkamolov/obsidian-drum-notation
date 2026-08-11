export function normalizeSourceText(source: string): string;
export function sourceChecksum(source: string): string;
export function digestRecords(records: Array<[string, string]>): string;
export function collectNotationCoreRecords(repoRoot?: string): Promise<Array<[string, string]>>;
export function getNotationCoreInfo(repoRoot?: string): Promise<{
  version: string;
  digest: string;
  inputs: string[];
}>;
export function collectNotationCoreRecordsSync(repoRoot?: string): Array<[string, string]>;
export function getNotationCoreInfoSync(repoRoot?: string): {
  version: string;
  digest: string;
  inputs: string[];
};
