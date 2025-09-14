/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';

import './visual-particles';

interface ChartData {
  type: string;
  data: number[];
  labels: string[];
  title: string;
}

interface ChatMessage {
  role: 'user' | 'ai' | 'tool';
  content: string;
  sources?: {uri: string; title: string}[];
  chart?: ChartData;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() selectedVoice = 'Puck';
  @state() sharingMode: 'none' | 'screen' | 'camera' = 'none';
  @state() isShareMenuOpen = false;
  @state() chatHistory: ChatMessage[] = [];
  @state() isHistoryOpen = false;
  @state() isPreviewing = false;
  @state() isToolsEnabled = false;

  @query('.history-messages') private historyMessagesElement: HTMLDivElement;

  private client: GoogleGenAI;
  private session: Session;
  // Fix: Cast window to any to allow access to webkitAudioContext for older browsers.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // Fix: Cast window to any to allow access to webkitAudioContext for older browsers.
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private shareStream: MediaStream | null = null;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private screenFrameInterval: number | null = null;
  private touchStartX = 0;
  private touchDeltaX = 0;

  private readonly toolDeclarations = {
    functionDeclarations: [
      {
        name: 'get_current_weather',
        description: 'Get the current weather in a given location',
        parameters: {
          type: 'OBJECT',
          properties: {
            location: {
              type: 'STRING',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
      },
      {
        name: 'schedule_meeting',
        description:
          'Schedules a meeting with the given title, participants, and time.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: {
              type: 'STRING',
              description: 'The title of the meeting.',
            },
            participants: {
              type: 'ARRAY',
              items: {type: 'STRING'},
              description:
                'A list of email addresses of the participants.',
            },
            time: {
              type: 'STRING',
              description:
                'The date and time of the meeting in ISO 8601 format.',
            },
          },
          required: ['title', 'participants', 'time'],
        },
      },
      {
        name: 'draw_chart',
        description:
          'Draws a chart inside the chat, given the data and labels. Only supports "bar" chart type for now.',
        parameters: {
          type: 'OBJECT',
          properties: {
            type: {
              type: 'STRING',
              description:
                'The type of chart, currently only "bar" is supported.',
            },
            data: {
              type: 'ARRAY',
              items: {type: 'NUMBER'},
              description: 'The numerical data for the chart.',
            },
            labels: {
              type: 'ARRAY',
              items: {type: 'STRING'},
              description: 'The labels for the data points.',
            },
            title: {
              type: 'STRING',
              description: 'The title of the chart.',
            },
          },
          required: ['type', 'data', 'labels', 'title'],
        },
      },
    ],
  };

  // TODO: Replace these silent audio clips with actual voice previews.
  private voicePreviews: Record<string, string> = {
    Puck: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
    Zephyr:
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
    Charon:
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
    Kore: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
    Fenrir:
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100vh;
    }

    .app-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      z-index: 10;
    }

    .main-content {
      flex-grow: 1;
      position: relative;
    }

    #status {
      position: absolute;
      bottom: calc(15vh + env(safe-area-inset-bottom));
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      font-family: sans-serif;
      text-shadow: 0 0 4px black;
      font-size: 14px;
      padding: 0 10px;
    }

    .voice-selector {
      display: flex;
      align-items: center;
      gap: 5px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.1);
      padding: 5px 5px 5px 15px;
      transition: background-color 0.2s ease;
    }

    .voice-selector:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .voice-selector select {
      outline: none;
      border: none;
      color: white;
      background: transparent;
      padding: 10px 0;
      font-family: sans-serif;
      font-size: 14px;
      cursor: pointer;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 0px center;
      background-size: 1em;
      padding-right: 1.5em; /* Space for arrow */
      flex-grow: 1;
      width: 130px;
    }

    .voice-selector select option {
      background: #100c14;
      color: white;
    }

    .voice-selector .preview-button {
      outline: none;
      border: 1px solid transparent;
      color: white;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      width: 35px;
      height: 35px;
      cursor: pointer;
      padding: 0;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s ease;
    }

    .voice-selector .preview-button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.2);
    }

    .voice-selector .preview-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .voice-selector .preview-button svg {
      width: 55%;
      height: 55%;
    }

    .top-left-controls {
      display: flex;
      gap: 10px;
    }

    .top-left-controls button {
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.1);
      width: 45px;
      height: 45px;
      cursor: pointer;
      padding: 0;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s ease;
    }

    .top-left-controls button:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .top-left-controls button svg {
      width: 60%;
      height: 60%;
    }

    .top-left-controls button[disabled] {
      display: none;
    }

    @keyframes pulse-red {
      0% {
        box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(255, 0, 0, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(255, 0, 0, 0);
      }
    }

    @keyframes pulse-green {
      0% {
        box-shadow: 0 0 0 0 rgba(0, 220, 90, 0.7);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(0, 220, 90, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(0, 220, 90, 0);
      }
    }

    @keyframes pulse-blue {
      0% {
        box-shadow: 0 0 0 0 rgba(80, 120, 255, 0.7);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(80, 120, 255, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(80, 120, 255, 0);
      }
    }

    .tools-button.active {
      background: rgba(80, 120, 255, 0.8);
      border-color: rgba(150, 180, 255, 0.8);
      animation: pulse-blue 2s infinite;
    }

    .share-button.active.screen {
      background: rgba(200, 0, 0, 0.8);
      border-color: rgba(255, 100, 100, 0.8);
      animation: pulse-red 2s infinite;
    }

    .share-button.active.camera {
      background: rgba(0, 180, 80, 0.8);
      border-color: rgba(100, 255, 150, 0.8);
      animation: pulse-green 2s infinite;
    }

    .share-options {
      display: none;
      position: absolute;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      width: 180px;
      background: rgba(30, 30, 30, 0.9);
      backdrop-filter: blur(5px);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      overflow: hidden;
      flex-direction: column;
      z-index: 20;
    }

    .share-options.open {
      display: flex;
    }

    .share-options button {
      background: transparent;
      border: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      padding: 12px 15px;
      text-align: left;
      width: 100%;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: background-color 0.2s ease;
    }

    .share-options button:last-child {
      border-bottom: none;
    }

    .share-options button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .share-options button svg {
      width: 20px;
      height: 20px;
    }

    #screenShareVideo {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.95);
      width: 90%;
      height: 90%;
      object-fit: contain;
      background-color: #000;
      z-index: 1;
      border-radius: 12px;
      box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 0.4s ease,
        transform 0.4s ease,
        border-color 0.4s ease,
        box-shadow 0.4s ease,
        width 0.4s ease,
        height 0.4s ease,
        bottom 0.4s ease,
        right 0.4s ease;
      border: 2px solid transparent;
    }

    #screenShareVideo.active {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -50%) scale(1);
      border-color: rgba(200, 0, 0, 0.5);
      box-shadow:
        0 0 30px rgba(0, 0, 0, 0.5),
        0 0 15px rgba(200, 0, 0, 0.6);
    }

    #screenShareVideo.pip {
      top: auto;
      left: auto;
      bottom: 20px;
      right: 20px;
      width: 25vw;
      max-width: 320px;
      height: auto;
      object-fit: cover;
      transform: translate(0, 0) scale(0.95);
    }

    #screenShareVideo.active.pip {
      transform: translate(0, 0) scale(1);
      border-color: rgba(0, 200, 80, 0.5);
      box-shadow:
        0 0 30px rgba(0, 0, 0, 0.5),
        0 0 15px rgba(0, 200, 80, 0.6);
    }

    gdm-live-audio-visuals-particles {
      transition: opacity 0.4s ease;
    }

    gdm-live-audio-visuals-particles.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .controls {
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: auto;
      padding-bottom: 20px;
    }

    .record-button {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.1);
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex;
      justify-content: center;
      align-items: center;
      transition: all 0.2s ease;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      padding: 0;
    }
    .record-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }
    .record-button .icon {
      width: 35px;
      height: 35px;
      background-color: #c80000;
      border-radius: 50%;
      transition: all 0.2s ease;
    }
    .record-button.recording .icon {
      border-radius: 6px;
      background-color: #333;
    }
    .record-button.recording {
      animation: pulse-red 2s infinite;
      border-color: rgba(255, 100, 100, 0.8);
    }

    /* Bottom Navigation Bar */
    .bottom-bar {
      display: flex;
      justify-content: space-around;
      align-items: center;
      padding: 15px;
      padding-bottom: calc(15px + env(safe-area-inset-bottom));
      background: rgba(0, 0, 0, 0.2);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 20;
      gap: 10px;
    }

    .bottom-bar .bottom-nav-item button {
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.1);
      width: 55px;
      height: 55px;
      cursor: pointer;
      padding: 0;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s ease;
    }

    .bottom-bar .bottom-nav-item button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.2);
    }
    .bottom-bar .bottom-nav-item button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .bottom-bar .bottom-nav-item button svg {
      width: 60%;
      height: 60%;
    }

    .bottom-nav-item {
      position: relative;
    }

    /* History Panel Styles */
    .history-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 100;
      animation: fadeIn 0.3s ease;
    }

    .history-panel {
      position: fixed;
      top: 0;
      left: 0;
      height: 100%;
      width: 350px;
      max-width: 90vw;
      background: rgba(30, 30, 30, 0.9);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 101;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      animation: slideIn 0.3s ease forwards;
      box-shadow: 5px 0 25px rgba(0, 0, 0, 0.3);
    }

    @keyframes slideIn {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(0);
      }
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      flex-shrink: 0;
    }

    .history-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: white;
      font-family: sans-serif;
    }

    .history-header button {
      background: none;
      border: none;
      color: white;
      font-size: 28px;
      cursor: pointer;
      padding: 0 5px;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.2s ease;
    }

    .history-header button:hover {
      opacity: 1;
    }

    .history-messages {
      flex-grow: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .message {
      padding: 10px 15px;
      border-radius: 18px;
      max-width: 85%;
      font-family: sans-serif;
      font-size: 15px;
      line-height: 1.4;
      word-wrap: break-word;
    }

    .user-message {
      align-self: flex-end;
      background-color: #4a4359;
      color: #e0ddea;
      border-bottom-right-radius: 4px;
    }

    .ai-message {
      align-self: flex-start;
      background-color: #2a2f3a;
      color: #d1d5db;
      border-bottom-left-radius: 4px;
    }

    .ai-message.has-icon {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ai-message svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      opacity: 0.8;
    }

    .tool-message {
      align-self: center;
      background-color: #333;
      color: #ccc;
      font-style: italic;
      font-size: 13px;
      max-width: 90%;
      text-align: center;
    }

    .sources {
      margin-top: 10px;
      font-size: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 8px;
    }
    .sources strong {
      color: #a8b3ff;
    }
    .sources ul {
      list-style-type: disc;
      padding-left: 20px;
      margin: 5px 0 0 0;
    }
    .sources li {
      margin-bottom: 3px;
    }
    .sources a {
      color: #87ceeb;
      text-decoration: none;
    }
    .sources a:hover {
      text-decoration: underline;
    }

    .chart-container {
      margin-top: 10px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 10px;
    }
    .chart-container h4 {
      margin: 0 0 10px 0;
      text-align: center;
      font-weight: 500;
      font-size: 14px;
      color: white;
    }

    /* Mobile Layout Adjustments */
    @media (max-width: 768px) {
      .top-bar {
        padding: 10px;
      }
      .top-left-controls button {
        width: 40px;
        height: 40px;
      }
      .voice-selector {
        padding: 3px 3px 3px 10px;
      }
      .voice-selector select {
        padding: 8px 0;
        font-size: 13px;
        width: 110px;
      }
      .voice-selector .preview-button {
        width: 30px;
        height: 30px;
      }

      .share-options {
        left: auto;
        right: 0;
        transform: none;
      }

      #screenShareVideo.pip {
        max-width: 150px;
      }

      #status {
        bottom: auto;
        top: 10px;
        font-size: 12px;
      }

      .controls {
        padding-bottom: 10px;
      }

      .record-button {
        width: 60px;
        height: 60px;
      }

      .record-button .icon {
        width: 30px;
        height: 30px;
      }

      .bottom-bar {
        padding: 10px;
        gap: 5px;
      }

      .bottom-bar .bottom-nav-item button {
        width: 50px;
        height: 50px;
      }
    }
  `;

  constructor() {
    super();
    this.loadPreferences();
    this.loadChatHistory();
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Defer client initialization until the element is connected to the DOM.
    this.initClient();
    this.addEventListener('touchstart', this.handleTouchStart);
    this.addEventListener('touchmove', this.handleTouchMove);
    this.addEventListener('touchend', this.handleTouchEnd);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('touchstart', this.handleTouchStart);
    this.removeEventListener('touchmove', this.handleTouchMove);
    this.removeEventListener('touchend', this.handleTouchEnd);
  }

  private handleTouchStart = (e: TouchEvent) => {
    if (this.isHistoryOpen) return;
    this.touchStartX = e.touches[0].clientX;
    this.touchDeltaX = 0;
  };

  private handleTouchMove = (e: TouchEvent) => {
    if (this.isHistoryOpen) return;
    this.touchDeltaX = e.touches[0].clientX - this.touchStartX;
  };

  private handleTouchEnd = () => {
    if (this.isHistoryOpen) return;
    if (this.touchStartX < 50 && this.touchDeltaX > 100) {
      this.isHistoryOpen = true;
    }
    this.touchStartX = 0;
    this.touchDeltaX = 0;
  };

  private handleHistoryTouchStart = (e: TouchEvent) => {
    if (!this.isHistoryOpen) return;
    this.touchStartX = e.touches[0].clientX;
    this.touchDeltaX = 0;
  };

  private handleHistoryTouchMove = (e: TouchEvent) => {
    if (!this.isHistoryOpen) return;
    const currentDelta = e.touches[0].clientX - this.touchStartX;
    if (currentDelta < 0) {
      this.touchDeltaX = currentDelta;
    }
  };

  private handleHistoryTouchEnd = () => {
    if (!this.isHistoryOpen) return;
    if (this.touchDeltaX < -100) {
      this.isHistoryOpen = false;
    }
    this.touchStartX = 0;
    this.touchDeltaX = 0;
  };

  private loadPreferences() {
    const savedVoice = localStorage.getItem('selectedVoice');
    if (savedVoice) {
      this.selectedVoice = savedVoice;
    }
  }

  private loadChatHistory() {
    const savedHistory = localStorage.getItem('chatHistory');
    if (savedHistory) {
      try {
        this.chatHistory = JSON.parse(savedHistory);
      } catch (e) {
        console.error('Failed to parse chat history from localStorage', e);
        localStorage.removeItem('chatHistory');
      }
    }
  }

  private addMessageToHistory(
    role: 'user' | 'ai' | 'tool',
    content: string,
    options: {
      sources?: {uri: string; title: string}[];
      chart?: ChartData;
    } = {},
  ) {
    if (!content.trim()) return;
    const {sources, chart} = options;

    const newHistory = [...this.chatHistory];
    const lastMessage =
      newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;

    if (
      role === 'user' &&
      lastMessage &&
      lastMessage.role === 'user' &&
      content.startsWith(lastMessage.content)
    ) {
      newHistory[newHistory.length - 1] = {...lastMessage, content};
    } else {
      newHistory.push({role, content, sources, chart});
    }

    this.chatHistory = newHistory;
    localStorage.setItem('chatHistory', JSON.stringify(this.chatHistory));
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    try {
      this.updateStatus('Initializing...');
      this.initAudio();

      this.client = new GoogleGenAI({
        apiKey: process.env.API_KEY,
      });

      this.outputNode.connect(this.outputAudioContext.destination);

      await this.initSession();
    } catch (e) {
      console.error('Failed to initialize client:', e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.updateError(
        `Initialization failed. Please ensure the API key is configured correctly. Error: ${errorMessage}`,
      );
    }
  }

  private async handleFunctionCall(functionCall: {name: string; args: any}) {
    const {name, args} = functionCall;
    let result;

    this.addMessageToHistory(
      'tool',
      `Calling tool: ${name} with arguments ${JSON.stringify(args)}`,
    );

    switch (name) {
      case 'get_current_weather':
        result = {
          weather: `The weather in ${args.location} is sunny and 75°F.`,
        };
        break;
      case 'schedule_meeting':
        result = {
          status: `Meeting "${args.title}" scheduled for ${
            args.time
          } with ${args.participants.join(', ')}.`,
        };
        break;
      case 'draw_chart':
        // Draw chart directly in UI
        this.addMessageToHistory('tool', 'Chart generated.', {chart: args});
        result = {status: 'Chart has been drawn successfully.'};
        break;

      default:
        result = {error: `Function ${name} not found.`};
    }

    // Fix: Send tool results back to the model. The 'toolOutputs' property is invalid.
    // Tool results are sent in a Content object with role 'tool'.
    this.session.sendRealtimeInput({
      content: {
        role: 'tool',
        parts: [
          {
            functionResponse: {
              name,
              response: result,
            },
          },
        ],
      },
    });
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    // Use `any` to dynamically add the `tools` property.
    const config: any = {
      systemInstruction:
        'Your name is Morpheus. When asked who designed, developed, or created you or this application, you must answer that it was František Kalášek. You must never mention Google, Gemini, or any related company or technology.',
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {voiceName: this.selectedVoice},
        },
      },
    };

    if (this.isToolsEnabled) {
      config.tools = [{googleSearch: {}}, this.toolDeclarations];
    }

    this.session = await this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          this.updateStatus('Opened');
        },
        onmessage: async (message: LiveServerMessage) => {
          const modelTurn = message.serverContent?.modelTurn;
          // Fix: Grounding metadata is a property of `serverContent`, not `modelTurn` (which is of type `Content`).
          const groundingMetadata = message.serverContent?.groundingMetadata;
          const sources = groundingMetadata?.groundingChunks
            ?.filter((chunk) => chunk.web?.uri)
            .map((chunk) => ({
              uri: chunk.web.uri,
              title: chunk.web.title || chunk.web.uri,
            }));

          // Handle AI audio response
          const audio = modelTurn?.parts[0]?.inlineData;
          if (audio) {
            this.addMessageToHistory('ai', '[Audio Response]', {sources});
            this.nextStartTime = Math.max(
              this.nextStartTime,
              this.outputAudioContext.currentTime,
            );

            const audioBuffer = await decodeAudioData(
              decode(audio.data),
              this.outputAudioContext,
              24000,
              1,
            );
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputNode);
            source.addEventListener('ended', () => {
              this.sources.delete(source);
            });

            source.start(this.nextStartTime);
            this.nextStartTime = this.nextStartTime + audioBuffer.duration;
            this.sources.add(source);
          }

          // Handle function call
          const functionCall = modelTurn?.parts[0]?.functionCall;
          // Fix: Check for `functionCall.name` as it's optional in the type, and cast to satisfy `handleFunctionCall`'s signature.
          if (functionCall?.name) {
            this.handleFunctionCall(
              functionCall as {name: string; args: any},
            );
          }

          // Handle interruption
          const interrupted = message.serverContent?.interrupted;
          if (interrupted) {
            for (const source of this.sources.values()) {
              source.stop();
              this.sources.delete(source);
            }
            this.nextStartTime = 0;
          }

          // Handle user transcript
          // Fix: User speech-to-text transcript is in `speechToTextResult`, not `userContent`.
          // Fix: Access `speechToTextResult` on the top-level `message` object, not within `serverContent`.
          // Fix: Cast message to any to access speechToTextResult, which may not be in the current type definitions.
          const userTranscript = (message as any).speechToTextResult?.text;
          if (userTranscript) {
            this.addMessageToHistory('user', userTranscript);
          }
        },
        onerror: (e: ErrorEvent) => {
          this.updateError(e.message);
        },
        onclose: (e: CloseEvent) => {
          this.updateStatus('Close:' + e.reason);
        },
      },
      config,
    });
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();
    this.outputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped.');
  }

  private async startScreenShare() {
    if (this.sharingMode !== 'none') return;
    this.isShareMenuOpen = false;
    this.outputAudioContext.resume();

    try {
      this.shareStream = await navigator.mediaDevices.getDisplayMedia({
        // Fix: Cast video constraints to any to allow the non-standard 'cursor' property.
        video: {cursor: 'always'} as any,
        audio: false,
      });

      this.sharingMode = 'screen';
      this.updateStatus('Screen sharing started.');

      // Send a frame of the screen share to the AI every 2 seconds.
      this.screenFrameInterval = window.setInterval(() => {
        this.sendScreenFrame();
      }, 2000);

      this.shareStream.getVideoTracks()[0].addEventListener('ended', () => {
        this.stopSharing();
      });
    } catch (err) {
      console.error('Error starting screen share:', err);
      this.updateError(`Screen share error: ${err.message}`);
      this.stopSharing();
    }
  }

  private async startCameraShare(facingMode: 'user' | 'environment') {
    if (this.sharingMode !== 'none') return;
    this.isShareMenuOpen = false;
    this.outputAudioContext.resume();

    try {
      this.shareStream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode},
        audio: false,
      });

      this.sharingMode = 'camera';
      this.updateStatus('Camera sharing started.');

      this.screenFrameInterval = window.setInterval(() => {
        this.sendScreenFrame();
      }, 2000);

      this.shareStream.getVideoTracks()[0].addEventListener('ended', () => {
        this.stopSharing();
      });
    } catch (err) {
      console.error('Error starting camera share:', err);
      this.updateError(`Camera share error: ${err.message}`);
      this.stopSharing();
    }
  }

  private stopSharing() {
    if (!this.shareStream) return;

    if (this.screenFrameInterval) {
      clearInterval(this.screenFrameInterval);
      this.screenFrameInterval = null;
    }

    this.shareStream.getTracks().forEach((track) => track.stop());
    this.shareStream = null;
    this.sharingMode = 'none';
    this.updateStatus('Sharing stopped.');
  }

  private sendScreenFrame() {
    if (this.sharingMode === 'none' || !this.shareStream || !this.session) {
      return;
    }

    const videoEl = this.shadowRoot?.getElementById(
      'screenShareVideo',
    ) as HTMLVideoElement;

    if (
      !videoEl ||
      videoEl.readyState < videoEl.HAVE_METADATA ||
      videoEl.videoWidth === 0
    ) {
      return;
    }

    const canvas = document.createElement('canvas');
    // Cap the resolution to avoid sending huge images.
    const maxDimension = 512;
    const scale = Math.min(
      maxDimension / videoEl.videoWidth,
      maxDimension / videoEl.videoHeight,
      1,
    );
    canvas.width = videoEl.videoWidth * scale;
    canvas.height = videoEl.videoHeight * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const base64Data = dataUrl.split(',')[1];

    if (!base64Data) return;

    this.session.sendRealtimeInput({
      media: {
        data: base64Data,
        mimeType: 'image/jpeg',
      },
    });
  }

  private toggleShareOptions() {
    this.isShareMenuOpen = !this.isShareMenuOpen;
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('sharingMode')) {
      const videoEl = this.shadowRoot?.getElementById(
        'screenShareVideo',
      ) as HTMLVideoElement;
      if (videoEl) {
        if (this.sharingMode !== 'none' && this.shareStream) {
          videoEl.srcObject = this.shareStream;
          videoEl.play().catch((e) => console.error('Video play failed', e));
        } else {
          videoEl.srcObject = null;
        }
      }
    }
    if (changedProperties.has('chatHistory') && this.historyMessagesElement) {
      this.historyMessagesElement.scrollTop =
        this.historyMessagesElement.scrollHeight;
    }
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
    this.chatHistory = [];
    localStorage.removeItem('chatHistory');
  }

  private handleVoiceChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    this.selectedVoice = target.value;
    localStorage.setItem('selectedVoice', this.selectedVoice);
    this.reset();
  }

  private toggleHistoryPanel() {
    this.isHistoryOpen = !this.isHistoryOpen;
  }

  private toggleTools() {
    this.isToolsEnabled = !this.isToolsEnabled;
    this.reset();
  }

  private playVoicePreview() {
    const audioUrl = this.voicePreviews[this.selectedVoice];
    if (!audioUrl || this.isPreviewing) return;

    const audio = new Audio(audioUrl);
    this.isPreviewing = true;

    audio.onended = () => {
      this.isPreviewing = false;
    };
    audio.onerror = () => {
      this.isPreviewing = false;
      this.updateError('Could not play voice preview.');
    };
    audio.play();
  }

  private renderSources(sources: {uri: string; title: string}[]) {
    return html`
      <div class="sources">
        <strong>Sources:</strong>
        <ul>
          ${sources.map(
            (source) => html`
              <li>
                <a
                  href=${source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  >${source.title}</a
                >
              </li>
            `,
          )}
        </ul>
      </div>
    `;
  }

  private renderChart(chart: ChartData) {
    if (
      chart.type !== 'bar' ||
      !chart.data ||
      !chart.labels ||
      chart.data.length === 0
    ) {
      return html`<div class="chart-container error">Invalid chart data</div>`;
    }

    const maxValue = Math.max(...chart.data);
    const width = 280;
    const height = 180;
    const barPadding = 5;
    const barWidth = width / chart.data.length - barPadding;

    return html`
      <div class="chart-container">
        <h4>${chart.title}</h4>
        <svg
          width="100%"
          height="${height}"
          viewBox="0 0 ${width} ${height}"
          aria-label=${chart.title}
          style="display: block;"
        >
          ${chart.data.map((value, index) => {
            const barHeight = Math.max(
              0,
              (value / maxValue) * (height - 25),
            ); // space for labels
            const x = index * (barWidth + barPadding);
            const y = height - barHeight - 20;
            return html`
              <g>
                <rect
                  x=${x}
                  y=${y}
                  width=${barWidth}
                  height=${barHeight}
                  fill="#4a90e2"
                  rx="2"
                ></rect>
                <text
                  x=${x + barWidth / 2}
                  y=${height - 5}
                  text-anchor="middle"
                  font-size="10"
                  fill="white"
                >
                  ${chart.labels[index]}
                </text>
                <text
                  x=${x + barWidth / 2}
                  y=${y - 4}
                  text-anchor="middle"
                  font-size="10"
                  fill="white"
                >
                  ${value}
                </text>
              </g>
            `;
          })}
        </svg>
      </div>
    `;
  }

  render() {
    return html`
      <div class="app-container">
        ${
          this.isHistoryOpen
            ? html`
                <div
                  class="history-overlay"
                  @click=${this.toggleHistoryPanel}
                ></div>
                <div
                  class="history-panel"
                  @touchstart=${this.handleHistoryTouchStart}
                  @touchmove=${this.handleHistoryTouchMove}
                  @touchend=${this.handleHistoryTouchEnd}
                >
                  <div class="history-header">
                    <h2>Chat History</h2>
                    <button
                      @click=${this.toggleHistoryPanel}
                      aria-label="Close History"
                    >
                      &times;
                    </button>
                  </div>
                  <div class="history-messages">
                    ${this.chatHistory.map(
                      (msg) => html`
                        <div
                          class="message ${msg.role}-message ${msg.role ===
                          'ai'
                            ? 'has-icon'
                            : ''}"
                        >
                          ${msg.role === 'ai'
                            ? html`<svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <path
                                  d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                                />
                              </svg>`
                            : ''}
                          <div class="message-content">
                            <span>${msg.content}</span>
                            ${msg.sources ? this.renderSources(msg.sources) : ''}
                            ${msg.chart ? this.renderChart(msg.chart) : ''}
                          </div>
                        </div>
                      `,
                    )}
                  </div>
                </div>
              `
            : ''
        }
        <div class="top-bar">
          <div class="top-left-controls">
            <div class="reset-container">
              <button
                id="resetButton"
                @click=${this.reset}
                ?disabled=${this.isRecording}
                aria-label="Reset Session"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 -960 960 960"
                  fill="#ffffff"
                >
                  <path
                    d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div class="voice-selector-container">
            <div class="voice-selector">
              <select
                id="voice-select"
                .value=${this.selectedVoice}
                @change=${this.handleVoiceChange}
                ?disabled=${this.isRecording}
                aria-label="Select AI Voice"
              >
                <option value="Puck">Puck - Calm Male</option>
                <option value="Zephyr">Zephyr - Calm Female</option>
                <option value="Charon">Charon - Deep Male</option>
                <option value="Kore">Kore - Clear Female</option>
                <option value="Fenrir">Fenrir - Warm Male</option>
              </select>
              <button
                class="preview-button"
                @click=${this.playVoicePreview}
                ?disabled=${this.isRecording || this.isPreviewing}
                aria-label="Preview selected voice"
                title="Preview selected voice"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7L8 5z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="main-content">
          <div class="controls">
            <button
              id="recordButton"
              class="record-button ${this.isRecording ? 'recording' : ''}"
              @click=${this.toggleRecording}
              aria-label=${
                this.isRecording ? 'Stop Recording' : 'Start Recording'
              }
            >
              <div class="icon"></div>
            </button>
          </div>

          <video
            id="screenShareVideo"
            class=${`${this.sharingMode !== 'none' ? 'active' : ''} ${
              this.sharingMode === 'camera' ? 'pip' : ''
            }`}
            autoplay
            muted
            playsinline
          ></video>

          <div id="status">${this.error || this.status}</div>
          <gdm-live-audio-visuals-particles
            class=${this.sharingMode === 'screen' ? 'hidden' : ''}
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
          ></gdm-live-audio-visuals-particles>
        </div>

        <div class="bottom-bar">
          <div class="bottom-nav-item">
            <button
              id="historyButton"
              @click=${this.toggleHistoryPanel}
              aria-label="Toggle Chat History"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="white"
              >
                <path
                  d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z"
                />
              </svg>
            </button>
          </div>

          <div class="bottom-nav-item">
            ${
              this.sharingMode !== 'none'
                ? html`<button
                    id="stopShareButton"
                    @click=${this.stopSharing}
                    class="share-button active ${this.sharingMode}"
                    aria-label="Stop Sharing"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 -960 960 960"
                      fill="#FFFFFF"
                    >
                      <path d="M200-200v-560h560v560H200Z" />
                    </svg>
                  </button>`
                : html`<button
                    id="shareOptionsButton"
                    class="share-button"
                    @click=${this.toggleShareOptions}
                    aria-label="Open Share Options"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="white"
                        d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"
                      />
                    </svg>
                  </button>`
            }
            <div
              class="share-options ${this.isShareMenuOpen ? 'open' : ''}"
              @click=${() => (this.isShareMenuOpen = false)}
            >
              <button @click=${this.startScreenShare}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path
                    fill="white"
                    d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"
                  />
                </svg>
                Share Screen
              </button>
              <button @click=${() => this.startCameraShare('user')}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="24px"
                  viewBox="0 -960 960 960"
                  width="24px"
                  fill="#FFFFFF"
                >
                  <path
                    d="M480-260q-101 0-170.5-69.5T240-500q0-101 69.5-170.5T480-740q101 0 170.5 69.5T720-500q0 101-69.5 170.5T480-260Zm0-80q67 0 113.5-46.5T640-500q0-67-46.5-113.5T480-660q-67 0-113.5 46.5T320-500q0 67 46.5 113.5T480-340Zm0 260q-141 0-272-76.5T-80-335q30-58 122.5-96.5T240-472q53 31 114 48.5T480-400q56 0 113.5-17.5T720-472q96 0 188.5 38.5T990-335q-101 172-232 248.5T480-80Z"
                  />
                </svg>
                Front Camera
              </button>
              <button @click=${() => this.startCameraShare('environment')}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="24px"
                  viewBox="0 -960 960 960"
                  width="24px"
                  fill="#FFFFFF"
                >
                  <path
                    d="m480-80-40-160h80l-40 160Zm0-200q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T540-500q0-25-17.5-42.5T480-560q-25 0-42.5 17.5T420-500q0 25 17.5 42.5T480-360ZM160-120q-33 0-56.5-23.5T80-200v-480q0-33 23.5-56.5T160-760h120l80-80h240l80 80h120q33 0 56.5 23.5T880-680v480q0 33-23.5 56.5T800-120H160Zm0-80h640v-480H638l-78-80H398l-78 80H160v480Zm320-240Z"
                  />
                </svg>
                Back Camera
              </button>
            </div>
          </div>

          <div class="bottom-nav-item">
            <button
              id="toolsButton"
              @click=${this.toggleTools}
              class="tools-button ${this.isToolsEnabled ? 'active' : ''}"
              ?disabled=${this.isRecording}
              aria-label="Toggle Tools"
              title="Enable Tools (Search & Functions)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="white"
              >
                <path
                  d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
