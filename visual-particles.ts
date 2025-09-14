/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';

const SPHERE_RADIUS = 8;

@customElement('gdm-live-audio-visuals-particles')
export class GdmLiveAudioVisualsParticles extends LitElement {
  private inputAnalyser: Analyser;
  private outputAnalyser: Analyser;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private particles: THREE.Points;
  private particlePositions: Float32Array;
  private basePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleCount: number;
  private prevTime = 0;
  private interactionPoint = new THREE.Vector3();
  private isInteracting = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2(1, 1); // Initialize off-screen
  private interactionSphere: THREE.Mesh;
  private currentColor: THREE.Color;
  private currentRadius: number;

  private _outputNode: AudioNode;
  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode, {fftSize: 64});
  }
  get outputNode() {
    return this._outputNode;
  }

  private _inputNode: AudioNode;
  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode, {fftSize: 64});
  }
  get inputNode() {
    return this._inputNode;
  }

  private canvas: HTMLCanvasElement;
  private animationFrameId: number;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      background-color: #100c14;
      cursor: grab;
      touch-action: none; /* Prevents scrolling on touch devices */
    }
    canvas:active {
      cursor: grabbing;
    }
  `;

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.onPointerDown,
    );
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener(
      'pointermove',
      this.onPointerMove,
    );
  }

  private onWindowResize = () => {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onPointerDown = () => {
    this.isInteracting = true;
  };

  private onPointerUp = () => {
    this.isInteracting = false;
  };

  private onPointerMove = (event: PointerEvent) => {
    // Normalize mouse coordinates to [-1, 1]
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  };

  private init() {
    const isMobile = window.innerWidth <= 768;
    this.particleCount = isMobile ? 4000 : 8000;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.z = 23;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Invisible sphere for raycasting mouse interactions
    this.interactionSphere = new THREE.Mesh(
      new THREE.SphereGeometry(SPHERE_RADIUS, 32, 32),
      new THREE.MeshBasicMaterial({visible: false}),
    );
    this.scene.add(this.interactionSphere);

    const geometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(this.particleCount * 3);
    this.basePositions = new Float32Array(this.particleCount * 3);
    this.particleVelocities = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);

    this.currentRadius = SPHERE_RADIUS;
    this.currentColor = new THREE.Color();
    this.currentColor.setHSL(0.6, 0.7, 0.4); // Default color

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Create a point on the surface of a sphere
      const vec = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();

      this.basePositions[i3] = vec.x * SPHERE_RADIUS;
      this.basePositions[i3 + 1] = vec.y * SPHERE_RADIUS;
      this.basePositions[i3 + 2] = vec.z * SPHERE_RADIUS;

      this.particlePositions[i3] = this.basePositions[i3];
      this.particlePositions[i3 + 1] = this.basePositions[i3 + 1];
      this.particlePositions[i3 + 2] = this.basePositions[i3 + 2];

      // Initialize velocities to zero
      this.particleVelocities[i3] = 0;
      this.particleVelocities[i3 + 1] = 0;
      this.particleVelocities[i3 + 2] = 0;

      // Set initial color
      colors[i3] = this.currentColor.r;
      colors[i3 + 1] = this.currentColor.g;
      colors[i3 + 2] = this.currentColor.b;
    }

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.particlePositions, 3),
    );
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);

    window.addEventListener('resize', this.onWindowResize);
    this.renderer.domElement.addEventListener(
      'pointerdown',
      this.onPointerDown,
    );
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener(
      'pointermove',
      this.onPointerMove,
    );
    this.animation();
  }

  private getFrequencyData(data: Uint8Array) {
    const bass = (data[0] + data[1]) / 2 / 255;
    const mid = data[Math.floor(data.length / 2)] / 255;
    const treble = (data[data.length - 1] + data[data.length - 2]) / 2 / 255;
    const total =
      Array.from(data).reduce((sum, val) => sum + val, 0) /
      data.length /
      255;
    return {bass, mid, treble, total};
  }

  private animation() {
    this.animationFrameId = requestAnimationFrame(() => this.animation());

    if (!this.inputAnalyser || !this.outputAnalyser) return;

    // Update audio data
    this.inputAnalyser.updateFrequencyData();
    this.outputAnalyser.updateFrequencyData();
    const input = this.getFrequencyData(this.inputAnalyser.frequencyData);
    const output = this.getFrequencyData(this.outputAnalyser.frequencyData);

    // Update raycaster for mouse interaction
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.interactionSphere);
    if (intersects.length > 0) {
      this.interactionPoint.copy(intersects[0].point);
    }

    const positions = this.particles.geometry.attributes.position
      .array as Float32Array;
    const colors = this.particles.geometry.attributes.color
      .array as Float32Array;

    const t = performance.now();
    const dt = Math.min(1.5, (t - this.prevTime) / (1000 / 60)); // Clamp dt
    this.prevTime = t;

    // --- Smooth visual parameters ---
    // Smooth Radius for breathing effect
    const bassEnergy = (input.bass + output.bass) / 2;
    const BASS_RADIUS_MULTIPLIER = 2.0; // Reduced for less dramatic expansion
    const targetRadius = SPHERE_RADIUS + bassEnergy * BASS_RADIUS_MULTIPLIER;
    this.currentRadius += (targetRadius - this.currentRadius) * 0.1; // Lerp

    // Smooth Color for gradient transition
    const targetColor = new THREE.Color();
    const aiEnergy = output.total; // Focus on AI output for color change
    targetColor.setHSL(
      (0.6 + 0.2 * output.mid) % 1.0, // Hue changes with AI voice tone
      0.7 + 0.3 * aiEnergy, // Saturation increases with AI volume
      Math.min(1.0, 0.4 + 0.6 * aiEnergy), // Brightness increases with AI volume
    );
    this.currentColor.lerp(targetColor, 0.05); // Slow lerp for smooth transition

    // Physics constants
    const SPRING_STRENGTH = 0.015; // Increased slightly for cohesion
    const DAMPING = 0.94; // Increased for smoother movement
    const JITTER_STRENGTH = 0.4; // Treble causes smaller, faster movements
    const INTERACTION_RADIUS_HOVER = 4.5;
    const INTERACTION_STRENGTH_HOVER = 0.08;
    const INTERACTION_RADIUS_ACTIVE = 8.0; // Increased range on click
    const INTERACTION_STRENGTH_ACTIVE = 0.25;

    const trebleEnergy = (input.treble + output.treble) / 2;

    // Dynamically adjust particle size based on treble
    (this.particles.material as THREE.PointsMaterial).size = Math.max(
      0.02,
      0.05 + 0.2 * trebleEnergy,
    );

    // Particle physics loop
    for (let i = 0; i < positions.length / 3; i++) {
      const i3 = i * 3;

      const pos = new THREE.Vector3(
        positions[i3],
        positions[i3 + 1],
        positions[i3 + 2],
      );
      const velocity = new THREE.Vector3(
        this.particleVelocities[i3],
        this.particleVelocities[i3 + 1],
        this.particleVelocities[i3 + 2],
      );

      // Get the base direction for this particle from its original spot
      const normal = new THREE.Vector3(
        this.basePositions[i3],
        this.basePositions[i3 + 1],
        this.basePositions[i3 + 2],
      ).normalize();

      // The new "home" for the particle is on the surface of the breathing sphere
      const targetPos = normal.clone().multiplyScalar(this.currentRadius);

      // Spring force: pulls particle back to its NEW dynamic target position
      const springForce = new THREE.Vector3()
        .subVectors(targetPos, pos)
        .multiplyScalar(SPRING_STRENGTH);

      // Treble frequencies cause smaller, faster movements (jitter)
      const jitterForce = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).multiplyScalar(trebleEnergy * JITTER_STRENGTH);

      // Interaction force: pushes particles away from the mouse, with increased range on click
      let interactionForce = new THREE.Vector3();
      const distToMouse = pos.distanceTo(this.interactionPoint);

      let radius = INTERACTION_RADIUS_HOVER;
      let strengthMultiplier = INTERACTION_STRENGTH_HOVER;

      if (this.isInteracting) {
        radius = INTERACTION_RADIUS_ACTIVE;
        strengthMultiplier = INTERACTION_STRENGTH_ACTIVE;
      }

      // Set base color for the particle
      colors[i3] = this.currentColor.r;
      colors[i3 + 1] = this.currentColor.g;
      colors[i3 + 2] = this.currentColor.b;

      if (distToMouse < radius) {
        const falloff = 1 - distToMouse / radius;
        const strength = falloff * strengthMultiplier;
        interactionForce
          .subVectors(pos, this.interactionPoint)
          .normalize()
          .multiplyScalar(strength);

        // Enhance color for particles within interaction radius
        const interactionColor = new THREE.Color(0xffffff);
        const finalColor = this.currentColor
          .clone()
          .lerp(interactionColor, falloff * 0.75); // Lerp towards white
        colors[i3] = finalColor.r;
        colors[i3 + 1] = finalColor.g;
        colors[i3 + 2] = finalColor.b;
      }

      // Update velocity
      velocity.add(springForce);
      velocity.add(jitterForce);
      velocity.add(interactionForce);
      velocity.multiplyScalar(DAMPING);

      // Update position
      pos.add(velocity.clone().multiplyScalar(dt));

      // Store updated values
      positions[i3] = pos.x;
      positions[i3 + 1] = pos.y;
      positions[i3 + 2] = pos.z;
      this.particleVelocities[i3] = velocity.x;
      this.particleVelocities[i3 + 1] = velocity.y;
      this.particleVelocities[i3 + 2] = velocity.z;
    }

    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;

    this.particles.rotation.y += 0.0005 * dt;
    this.particles.rotation.x += 0.0002 * dt;

    this.renderer.render(this.scene, this.camera);
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas')!;
    this.init();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-particles': GdmLiveAudioVisualsParticles;
  }
}
