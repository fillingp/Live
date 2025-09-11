/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

@customElement('gdm-live-audio-visuals-waveform')
export class GdmLiveAudioVisualsWaveform extends LitElement {
  private inputAnalyser: Analyser;
  private outputAnalyser: Analyser;
  private _outputNode: AudioNode;
  private _inputNode: AudioNode;
  private canvas: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;
  private animationFrameId: number;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode, {fftSize: 2048});
  }
  get outputNode() {
    return this._outputNode;
  }

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode, {fftSize: 2048});
  }
  get inputNode() {
    return this._inputNode;
  }

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.visualize();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  private visualize() {
    if (this.canvas && this.outputAnalyser && this.inputAnalyser) {
      this.inputAnalyser.updateTimeDomainData();
      this.outputAnalyser.updateTimeDomainData();

      const WIDTH = this.canvas.width;
      const HEIGHT = this.canvas.height;
      this.canvasCtx.fillStyle = 'rgb(16, 12, 20)';
      this.canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      this.drawWave(this.inputAnalyser, '#D16BA5', 1.5);
      this.drawWave(this.outputAnalyser, '#3b82f6', 2);
    }
    this.animationFrameId = requestAnimationFrame(() => this.visualize());
  }

  private drawWave(analyser: Analyser, color: string, lineWidth: number) {
    const dataArray = analyser.timeDomainData;
    const bufferLength = analyser.bufferLengthTimeDomain;
    const WIDTH = this.canvas.width;
    const HEIGHT = this.canvas.height;

    this.canvasCtx.lineWidth = lineWidth;
    this.canvasCtx.strokeStyle = color;
    this.canvasCtx.beginPath();

    const sliceWidth = (WIDTH * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * HEIGHT) / 2;

      if (i === 0) {
        this.canvasCtx.moveTo(x, y);
      } else {
        this.canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    this.canvasCtx.lineTo(this.canvas.width, this.canvas.height / 2);
    this.canvasCtx.stroke();
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvasCtx = this.canvas.getContext('2d')!;
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-waveform': GdmLiveAudioVisualsWaveform;
  }
}
