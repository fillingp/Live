/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Analyser class for live audio visualisation.
 */
export class Analyser {
  private analyser: AnalyserNode;
  private freqBufferLength: number;
  private freqDataArray: Uint8Array;
  private timeDomainDataArray: Uint8Array;

  constructor(node: AudioNode, options: {fftSize?: number} = {}) {
    this.analyser = node.context.createAnalyser();
    this.analyser.fftSize = options.fftSize || 32;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freqBufferLength = this.analyser.frequencyBinCount;
    this.freqDataArray = new Uint8Array(this.freqBufferLength);
    this.timeDomainDataArray = new Uint8Array(this.analyser.fftSize);
    node.connect(this.analyser);
  }

  updateFrequencyData() {
    this.analyser.getByteFrequencyData(this.freqDataArray);
  }

  updateTimeDomainData() {
    this.analyser.getByteTimeDomainData(this.timeDomainDataArray);
  }

  get frequencyData() {
    return this.freqDataArray;
  }

  get timeDomainData() {
    return this.timeDomainDataArray;
  }

  get bufferLengthFrequency() {
    return this.freqBufferLength;
  }

  get bufferLengthTimeDomain() {
    return this.analyser.fftSize;
  }
}
