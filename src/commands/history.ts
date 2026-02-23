export interface HistoryOptions {
  platform?: string;
  limit: string;
  json: boolean;
  nonInteractive: boolean;
}

export default async function historyCmd(opts: HistoryOptions): Promise<void> {
  console.log("Not implemented yet");
}
