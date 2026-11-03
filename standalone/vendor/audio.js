/* Codec local compartilhado pelo renderer nativo e pelo navegador. Sem rede. */
(function (root) {
  'use strict';
  async function toWav(input, maxSeconds = 120) {
    const bytes = input instanceof Blob ? await input.arrayBuffer() : input;
    if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new Error('INVALID_AUDIO');
    const decoder = new OfflineAudioContext(1, 1, 16000);
    const audio = await decoder.decodeAudioData(bytes.slice(0));
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > maxSeconds + 1) throw new Error('INVALID_AUDIO');
    const frames = Math.ceil(audio.duration * 16000);
    const resampler = new OfflineAudioContext(1, frames, 16000);
    const source = resampler.createBufferSource(); source.buffer = audio; source.connect(resampler.destination); source.start();
    const pcm = (await resampler.startRendering()).getChannelData(0);
    const wav = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(wav);
    const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const value = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true);
    }
    return wav;
  }
  root.AferiaAudio = Object.freeze({ toWav });
})(globalThis);
