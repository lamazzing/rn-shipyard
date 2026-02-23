export interface BuildOptions {
  platform: string;
  profile: string;
  submit: boolean;
  skipVersionCheck: boolean;
  json: boolean;
  nonInteractive: boolean;
}

export default async function buildCmd(opts: BuildOptions): Promise<void> {
  console.log("Not implemented yet");
}
