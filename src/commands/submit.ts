export interface SubmitOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
}

export default async function submitCmd(opts: SubmitOptions): Promise<void> {
  console.log("Not implemented yet");
}
