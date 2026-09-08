import { SyncDSP } from './sync-dsp.js';

class SyncProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new SyncDSP(sampleRate);
    this.right = new SyncDSP(sampleRate);
    this.epoch = 0;
    this.port.onmessage = ({ data }) => {
      this.epoch = data.epoch;
      this.dsp = new SyncDSP(sampleRate); this.right = new SyncDSP(sampleRate);
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length) {
      // Both channels are analysed independently; the consumer coalesces simultaneous events.
      this.dsp.process([channels[0]], currentFrame, packet => this.port.postMessage({ ...packet, epoch: this.epoch }));
      if (channels[1]) this.right.process([channels[1]], currentFrame, packet => this.port.postMessage({ ...packet, epoch: this.epoch }));
    }
    return true; // Output stays zero: this analysis branch never plays captured audio.
  }
}
registerProcessor('audio-sync', SyncProcessor);
