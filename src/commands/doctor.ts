export interface DoctorOptions {
  platform: string;
  json: boolean;
  nonInteractive: boolean;
}

export default async function doctorCmd(opts: DoctorOptions): Promise<void> {
  console.log("Not implemented yet");
}
