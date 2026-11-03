export {};
declare global {
  const AferiaAudio: { toWav(input: Blob | ArrayBuffer, maxSeconds?: number): Promise<ArrayBuffer> };
}
