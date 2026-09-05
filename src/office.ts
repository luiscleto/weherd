import * as THREE from 'three';
import type { Agent } from './types';

const C = { green: 0x275849, lime: 0xd5e987, wood: 0xe7bb87, cream: 0xf8f2e5, ink: 0x253c37, floor: 0xf0dfbd, red: 0xe57065, teal: 0x74b9a9 };
const palette = [0x559b88, 0xdca569, 0x769cbc, 0xad91b4, 0x668f74, 0xca8d80, 0x8594bf];
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const materials = { wood: mat(C.wood), cream: mat(C.cream), ink: mat(C.ink), floor: mat(C.floor), green: mat(C.green), teal: mat(C.teal), metal: mat(0x61716a), glass: mat(0xafd3c5, { transparent: true, opacity: 0.2, roughness: 0.1, depthWrite: false }), screen: mat(0x70c4af, { emissive: 0x326b5c, emissiveIntensity: 0.4 }), pot: mat(0xd79d7a), leaf: mat(0x46775c), soil: mat(0x685747), coffee: mat(0x594638) };
interface Rect { x: number; z: number; w: number; d: number }
interface Person {
  root: THREE.Group; body: THREE.Mesh; head: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group;
  leftLeg: THREE.Group; rightLeg: THREE.Group; cup: THREE.Group; label: THREE.Sprite; ring: THREE.Mesh;
}
interface AgentPerson extends Person { agent: Agent; slot: number; target: THREE.Vector3; phase: number; path: THREE.Vector3[] }
interface Effect { object: THREE.Object3D; time: number; lifetime: number }
export interface OfficeCallbacks { near: (agent: Agent | null) => void; shoot: (agent: Agent) => void; equipped: (value: boolean) => void; interact: () => void }

export class Office {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-25, 25, 18, -18, 0.1, 200);
  private renderer: THREE.WebGLRenderer;
  private environment = new THREE.Group();
  private people = new Map<string, AgentPerson>();
  private player: Person;
  private gun = new THREE.Group();
  private aim = new THREE.Mesh(new THREE.RingGeometry(0.21, 0.25, 24), new THREE.MeshBasicMaterial({ color: C.green, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  private pointer = new THREE.Vector2(0, 0);
  private aimPoint = new THREE.Vector3(0, 0, -4);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private keys = new Set<string>();
  private colliders: Rect[] = [];
  private blockers: THREE.Object3D[] = [];
  private deskSlots: THREE.Vector3[] = [];
  private coffeeSlots: THREE.Vector3[] = [];
  private lastTick = performance.now();
  private elapsed = 0;
  private effects: Effect[] = [];
  private capacity = 0;
  private roomWidth = 30;
  private roomDepth = 24;
  private coffeeX = 9;
  private nearId: string | null = null;
  private paused = false;
  private equipped = false;
  private lastFire = 0;
  private focusTarget: string | null = null;
  private audio: AudioContext | null = null;
  private zoom = 1;
  private moved = false;
  private observer: ResizeObserver;

  constructor(private container: HTMLElement, private callbacks: OfficeCallbacks) {
    this.scene.background = new THREE.Color(0xe8eee6);
    this.scene.fog = new THREE.Fog(0xe8eee6, 70, 140);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D office. Use WASD to move, E to interact, and Q to equip the shotgun.');
    this.renderer.domElement.tabIndex = 0;
    this.container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xfffbef, 0x9bbab0, 3));
    const sun = new THREE.DirectionalLight(0xffeed0, 4.1);
    sun.position.set(-12, 26, -15); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 80 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(this.environment);
    this.player = this.createPerson('YOU', C.green, true);
    this.player.root.position.set(1.5, 0, 8);
    this.scene.add(this.player.root);
    this.makeGun();
    this.player.root.add(this.gun);
    this.gun.visible = false;
    this.aim.rotation.x = -Math.PI / 2; this.aim.position.y = 0.04; this.aim.visible = false;
    this.scene.add(this.aim);
    this.buildOffice(12);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    this.renderer.domElement.addEventListener('pointermove', this.pointermove);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerdown);
    this.renderer.domElement.addEventListener('wheel', this.wheel, { passive: false });
    this.renderer.setAnimationLoop(this.animate);
    this.resize();
  }

  private box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material = materials.wood): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private cylinder(parent: THREE.Object3D, r1: number, r2: number, h: number, x: number, y: number, z: number, material = materials.cream, segments = 12): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, segments), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private plant(x: number, z: number, size = 1) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.scale.setScalar(size);
    this.cylinder(group, 0.42, 0.32, 0.65, 0, 0.33, 0, materials.pot);
    this.cylinder(group, 0.38, 0.38, 0.03, 0, 0.67, 0, materials.soil);
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.38, 7, 5), materials.leaf);
      leaf.scale.set(0.62, 1.8, 0.48); leaf.rotation.set(0.5 * Math.cos(angle), angle, 0.5 * Math.sin(angle));
      leaf.position.set(Math.cos(angle) * 0.29, 1.08 + (i % 3) * 0.2, Math.sin(angle) * 0.29); leaf.castShadow = true; group.add(leaf);
    }
    this.environment.add(group);
    this.colliders.push({ x, z, w: size * 0.7, d: size * 0.7 });
  }
  private textSprite(text: string, subtext = '', color = '#275849', width = 256): THREE.Sprite {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = subtext ? 100 : 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fcfaf3'; ctx.beginPath(); ctx.roundRect(3, 3, width - 6, canvas.height - 6, 16); ctx.fill();
    ctx.strokeStyle = '#254e421a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = 'bold 27px system-ui'; ctx.fillText(text, width / 2, subtext ? 40 : 42, width - 25);
    if (subtext) { ctx.font = '500 20px system-ui'; ctx.fillStyle = color; ctx.fillText(subtext, width / 2, 74); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(2.55, subtext ? 1 : 0.64, 1); sprite.renderOrder = 9; return sprite;
  }
  private wallSign(text: string, x: number, y: number, z: number, width = 3.5) {
    const sprite = this.textSprite(text, '', '#416357', 320); sprite.position.set(x, y, z); sprite.scale.set(width, 0.7, 1); this.environment.add(sprite);
  }
  private desk(x: number, z: number, index: number) {
    const g = new THREE.Group(); g.position.set(x, 0, z); this.environment.add(g);
    const top = this.box(g, 3.1, 0.16, 1.45, 0, 1.12, 0);
    this.blockers.push(top);
    for (const dx of [-1.25, 1.25]) for (const dz of [-0.5, 0.5]) this.box(g, 0.11, 1.04, 0.11, dx, 0.52, dz, materials.cream);
    this.box(g, 1.06, 0.045, 0.65, 0, 1.24, 0.05, materials.ink);
    const screen = this.box(g, 1.06, 0.67, 0.05, 0, 1.56, -0.26, materials.ink); screen.rotation.x = -0.12;
    const display = this.box(g, 0.92, 0.52, 0.016, 0, 1.57, -0.22, materials.screen); display.rotation.x = -0.12;
    for (let l = 0; l < 4; l++) this.box(g, 0.23 + (l % 2) * 0.22, 0.027, 0.018, -0.17 + (l % 2) * 0.08, 1.71 - l * 0.09, -0.177, materials.cream);
    this.box(g, 0.4, 0.03, 0.55, -1.07, 1.23, 0.04, mat(index % 2 ? 0xdceaac : 0xb3c8d3));
    this.cylinder(g, 0.095, 0.08, 0.2, 1.13, 1.3, 0.18);
    this.cylinder(g, 0.072, 0.072, 0.01, 1.13, 1.405, 0.18, materials.coffee);
    this.box(g, 0.74, 0.15, 0.68, 0, 0.58, 1.04, materials.teal);
    this.box(g, 0.74, 0.65, 0.14, 0, 0.98, 1.36, materials.teal);
    this.cylinder(g, 0.065, 0.065, 0.49, 0, 0.26, 1.06, materials.ink);
    this.box(g, 0.76, 0.075, 0.12, 0, 0.055, 1.06, materials.ink);
    this.box(g, 0.12, 0.075, 0.7, 0, 0.055, 1.06, materials.ink);
    this.colliders.push({ x, z, w: 3.2, d: 1.5 });
  }
  private buildOffice(capacity: number) {
    for (const child of [...this.environment.children]) { this.disposeObject(child); this.environment.remove(child); }
    this.colliders = []; this.blockers = []; this.deskSlots = []; this.coffeeSlots = [];
    this.capacity = capacity;
    const rows = capacity <= 12 ? 4 : capacity <= 24 ? 6 : 8;
    const cols = Math.ceil(capacity / rows);
    this.roomWidth = cols * 4.6 + 12; this.roomDepth = rows * 3.9 + 6;
    const left = -this.roomWidth / 2; const back = -this.roomDepth / 2;
    this.coffeeX = left + cols * 4.6 + 6;
    this.box(this.environment, this.roomWidth + 0.5, 0.52, this.roomDepth + 0.5, 0, -0.31, 0, materials.cream);
    this.box(this.environment, this.roomWidth, 0.12, this.roomDepth, 0, -0.015, 0, materials.floor);
    const seam = mat(0xdacaa9);
    for (let z = back + 0.7; z < -back; z += 0.85) this.box(this.environment, this.roomWidth - 0.12, 0.004, 0.012, 0, 0.05, z, seam);
    this.box(this.environment, 0.22, 4.25, this.roomDepth, left, 2.1, 0, materials.cream);
    this.box(this.environment, this.roomWidth, 4.25, 0.22, 0, 2.1, back, materials.cream);
    this.box(this.environment, this.roomWidth, 0.22, 0.32, 0, 4.25, back, materials.wood);
    for (let x = left + 2; x < this.roomWidth / 2 - 1; x += 4.6) {
      this.box(this.environment, 3.5, 2.42, 0.07, x, 2.55, back + 0.14, mat(0xc9ddd5, { emissive: 0xb9cfb9, emissiveIntensity: 0.18 }));
      this.box(this.environment, 0.075, 2.6, 0.12, x, 2.55, back + 0.23, materials.cream);
      this.box(this.environment, 3.7, 0.12, 0.4, x, 1.25, back + 0.28, materials.cream);
      this.box(this.environment, 3.7, 0.08, 0.12, x, 2.65, back + 0.23, materials.cream);
    }
    const carpet = mat(0xbdcbc0);
    this.box(this.environment, cols * 4.6 - 0.2, 0.03, rows * 3.9 + 0.6, left + cols * 2.3 + 1.7, 0.066, 0.1, carpet);
    for (let i = 0; i < capacity; i++) {
      const x = left + 3.5 + (i % cols) * 4.6;
      const z = back + 3.1 + Math.floor(i / cols) * 3.9;
      this.desk(x, z, i); this.deskSlots.push(new THREE.Vector3(x, 0, z + 1.06));
    }
    // The right-hand wing keeps a clear walking aisle between work and coffee.
    const right = this.roomWidth / 2;
    this.box(this.environment, 5.5, 1.2, 1.3, right - 3.8, 0.6, back + 1.25, materials.green);
    this.box(this.environment, 5.7, 0.12, 1.55, right - 3.8, 1.26, back + 1.25, materials.cream);
    this.colliders.push({ x: right - 3.8, z: back + 1.25, w: 5.8, d: 1.7 });
    this.box(this.environment, 0.85, 0.85, 0.65, right - 4.9, 1.74, back + 1.3, materials.ink);
    this.box(this.environment, 0.63, 0.4, 0.05, right - 4.9, 1.67, back + 1.65, materials.metal);
    this.cylinder(this.environment, 0.1, 0.09, 0.23, right - 4.9, 1.48, back + 1.77);
    for (let i = 0; i < 3; i++) this.cylinder(this.environment, 0.1, 0.09, 0.2, right - 3.2 + i * 0.3, 1.43, back + 1.3);
    this.wallSign('THE DAILY GRIND', right - 3.8, 3.65, back + 0.7, 4.2);
    this.plant(right - 0.8, back + 1.1, 1.5);
    const tableZ = back + 5.4;
    this.cylinder(this.environment, 1.12, 1.12, 0.12, this.coffeeX, 1.22, tableZ, materials.wood, 32);
    this.cylinder(this.environment, 0.09, 0.12, 1.17, this.coffeeX, 0.6, tableZ, materials.ink);
    this.cylinder(this.environment, 0.6, 0.6, 0.08, this.coffeeX, 0.08, tableZ, materials.ink);
    this.colliders.push({ x: this.coffeeX, z: tableZ, w: 2.1, d: 2.1 });
    // Lounge rug, sofa, side chair and a small glass meeting nook.
    this.box(this.environment, 6.2, 0.035, 5.6, right - 3.9, 0.07, 2.6, mat(0xe8bc94));
    this.box(this.environment, 1.45, 0.65, 3.9, right - 1.7, 0.48, 2.4, mat(0xc7aa7d));
    this.box(this.environment, 0.28, 1.1, 4.1, right - 1.05, 0.82, 2.4, mat(0xc7aa7d));
    for (const z of [0.5, 4.3]) this.box(this.environment, 1.5, 0.85, 0.25, right - 1.65, 0.65, z, mat(0xc7aa7d));
    for (const z of [1.1, 2.4, 3.7]) this.box(this.environment, 1.2, 0.16, 1.15, right - 1.85, 0.89, z, materials.cream);
    this.colliders.push({ x: right - 1.7, z: 2.4, w: 1.7, d: 4.3 });
    this.cylinder(this.environment, 0.93, 0.93, 0.13, right - 4, 0.67, 2.4, materials.cream, 24);
    this.cylinder(this.environment, 0.43, 0.54, 0.6, right - 4, 0.33, 2.4, materials.pot);
    this.colliders.push({ x: right - 4, z: 2.4, w: 1.8, d: 1.8 });
    this.box(this.environment, 0.5, 0.07, 0.65, right - 4, 0.79, 2.4, materials.green);
    this.plant(right - 1.1, 6.5, 1.4);
    const glassZ = Math.min(this.roomDepth / 2 - 1.3, 8.5);
    this.box(this.environment, 5.3, 2.9, 0.06, right - 3.65, 1.47, glassZ, materials.glass);
    for (let x = right - 6.3; x <= right - 1; x += 2.65) this.box(this.environment, 0.06, 3.03, 0.09, x, 1.51, glassZ, materials.metal);
    this.box(this.environment, 5.4, 0.06, 0.08, right - 3.65, 3.04, glassZ, materials.metal);
    this.colliders.push({ x: right - 3.65, z: glassZ, w: 5.4, d: 0.1 });
    for (let z = back + 3; z < this.roomDepth / 2 - 0.6; z += 1.35) {
      for (let x = right - 6.4; x < right - 0.7; x += 1.35) {
        if (this.canMove(x, z)) this.coffeeSlots.push(new THREE.Vector3(x, 0, z));
      }
    }
    this.plant(left + 0.9, this.roomDepth / 2 - 1.1, 1.6);
    this.plant(left + 0.8, back + 1, 1.2);
    this.wallSign('make room for good work.', left + 0.5, 3, 0, 4.4);
    this.wallSign('COFFEE & COMPANY', right - 4, 0.15, glassZ + 1.2, 4.4);
    this.ensureWalkablePlayerPosition();
    this.resize();
  }

  private ensureWalkablePlayerPosition() {
    const position = this.player.root.position;
    if (this.canMove(position.x, position.z)) return;
    // Room growth can put a new desk under the player. Search the rebuilt
    // collision map for the nearest clear position, preserving valid positions.
    let nearest: THREE.Vector3 | null = null;
    let distance = Infinity;
    const consider = (x: number, z: number) => {
      if (!this.canMove(x, z)) return;
      const candidateDistance = (x - position.x) ** 2 + (z - position.z) ** 2;
      if (candidateDistance < distance) { distance = candidateDistance; nearest = new THREE.Vector3(x, 0, z); }
    };
    const front = this.roomDepth / 2 - 0.8;
    const back = -this.roomDepth / 2 + 0.8;
    const corridorX = this.coffeeX - 4;
    consider(corridorX, THREE.MathUtils.clamp(position.z, back, front));
    consider(corridorX, front);
    for (let z = back; z <= front; z += 0.4) {
      for (let x = -this.roomWidth / 2 + 0.8; x <= this.roomWidth / 2 - 0.8; x += 0.4) consider(x, z);
    }
    if (nearest) position.copy(nearest);
    this.keys.clear();
  }

  private createPerson(name: string, color: number, player = false): Person {
    const root = new THREE.Group();
    const bodyMaterial = mat(color);
    const body = this.box(root, 0.56, 0.65, 0.39, 0, 1.05, 0, bodyMaterial);
    const head = new THREE.Group(); head.position.y = 1.52; root.add(head);
    this.box(head, 0.44, 0.46, 0.42, 0, 0.1, 0, mat(0xedc2a0));
    this.box(head, 0.47, 0.16, 0.45, 0, 0.32, 0.015, mat(player ? 0x4e453c : 0x574d44));
    this.box(head, 0.1, 0.29, 0.44, -0.19, 0.19, 0.025, mat(0x574d44));
    for (const x of [-0.1, 0.1]) this.box(head, 0.038, 0.047, 0.024, x, 0.1, -0.22, materials.ink);
    const limb = (x: number, y: number, arm: boolean) => {
      const group = new THREE.Group(); group.position.set(x, y, 0); root.add(group);
      this.box(group, arm ? 0.17 : 0.2, arm ? 0.47 : 0.57, arm ? 0.2 : 0.25, 0, arm ? -0.2 : -0.26, 0, arm ? bodyMaterial : materials.ink);
      if (arm) this.box(group, 0.17, 0.16, 0.2, 0, -0.46, 0, mat(0xedc2a0));
      else this.box(group, 0.23, 0.13, 0.37, 0, -0.56, -0.05, materials.cream);
      return group;
    };
    const leftArm = limb(-0.38, 1.29, true); const rightArm = limb(0.38, 1.29, true);
    const leftLeg = limb(-0.15, 0.67, false); const rightLeg = limb(0.15, 0.67, false);
    const cup = new THREE.Group(); cup.position.set(0, -0.47, -0.05); rightArm.add(cup);
    this.cylinder(cup, 0.105, 0.09, 0.2, 0, 0, -0.12); this.cylinder(cup, 0.08, 0.08, 0.012, 0, 0.1, -0.12, materials.coffee); cup.visible = false;
    const label = this.textSprite(name, player ? '' : 'WORKING'); label.position.set(0, 2.5, 0); root.add(label);
    if (player) { label.scale.set(1.1, 0.4, 1); label.position.y = 2.32; }
    const ring = new THREE.Mesh(new THREE.RingGeometry(player ? 0.42 : 0.5, player ? 0.51 : 0.58, 32), new THREE.MeshBasicMaterial({ color: player ? C.green : C.lime, side: THREE.DoubleSide, transparent: true, opacity: player ? 0.7 : 0 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.075; root.add(ring);
    return { root, body, head, leftArm, rightArm, leftLeg, rightLeg, cup, label, ring };
  }
  private makeGun() {
    this.gun.position.set(0.28, 1.05, -0.24);
    this.box(this.gun, 0.14, 0.15, 0.96, 0, 0, -0.35, materials.ink);
    this.box(this.gun, 0.19, 0.2, 0.34, 0, -0.02, 0.15, mat(0x996747));
    this.box(this.gun, 0.18, 0.17, 0.25, 0, -0.04, -0.4, mat(0xb78657));
    this.box(this.gun, 0.055, 0.055, 0.12, 0, 0.1, -0.77, materials.metal);
  }
  setAgents(agents: Agent[]) {
    const desired = agents.length <= 12 ? 12 : agents.length <= 24 ? 24 : Math.ceil(agents.length / 24) * 24;
    const rebuilding = desired !== this.capacity;
    if (rebuilding) this.buildOffice(desired);
    const ids = new Set(agents.map(a => a.id));
    for (const [id, person] of this.people) if (!ids.has(id)) { this.scene.remove(person.root); this.disposeObject(person.root); this.people.delete(id); }
    if (rebuilding) [...this.people.values()].forEach((person, index) => { person.slot = index; });
    const used = new Set([...this.people.values()].map(p => p.slot));
    for (const agent of agents) {
      let person = this.people.get(agent.id);
      const isNew = !person;
      if (!person) {
        let slot = 0; while (used.has(slot)) slot++; used.add(slot);
        person = { ...this.createPerson(agent.name, palette[slot % palette.length]), agent, slot, target: new THREE.Vector3(), phase: slot * 1.78, path: [] };
        this.people.set(agent.id, person); this.scene.add(person.root);
        person.root.traverse(o => { if (o instanceof THREE.Mesh && o !== person!.ring) o.userData.agentId = agent.id; });
      }
      const changed = isNew || person.agent.status !== agent.status || person.agent.name !== agent.name || rebuilding;
      person.agent = agent;
      if (changed) {
        const coffee = agent.status === 'idle' || agent.status === 'done';
        const target = coffee ? this.coffeeSlots[person.slot % this.coffeeSlots.length] : this.deskSlots[person.slot];
        person.target.copy(target);
        if (isNew || rebuilding) { person.root.position.copy(target); person.path = []; }
        else person.path = this.route(person.root.position, target);
        (person.body.material as THREE.MeshStandardMaterial).color.setHex(agent.status === 'blocked' ? C.red : palette[person.slot % palette.length]);
        for (const arm of [person.leftArm, person.rightArm]) (arm.children[0] as THREE.Mesh).material = person.body.material;
        person.root.remove(person.label); this.disposeObject(person.label);
        const status = { working: 'AT WORK', blocked: 'NEEDS YOU', done: 'ALL DONE', idle: 'COFFEE BREAK', unknown: 'STANDING BY' }[agent.status];
        person.label = this.textSprite(agent.name, status, agent.status === 'blocked' ? '#b84f45' : '#275849'); person.label.position.set(0, 2.75, 0); person.root.add(person.label);
      }
    }
  }
  private route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    // Desks open onto horizontal aisles; route state changes through the central corridor.
    const corridorX = this.coffeeX - 4;
    return [new THREE.Vector3(from.x, 0, from.z + 0.85), new THREE.Vector3(corridorX, 0, from.z + 0.85), new THREE.Vector3(corridorX, 0, to.z + 0.85), new THREE.Vector3(to.x, 0, to.z + 0.85), to.clone()];
  }
  setPaused(paused: boolean) { this.paused = paused; this.keys.clear(); }
  setEquipped(equipped: boolean) { this.equipped = equipped; this.gun.visible = equipped; this.aim.visible = equipped; this.container.classList.toggle('armed', equipped); this.callbacks.equipped(equipped); }
  toggleEquipped() { this.setEquipped(!this.equipped); }
  focusAgent(id: string) { if (this.people.has(id)) this.focusTarget = id; }
  getNearest(): Agent | null { return this.nearId ? this.people.get(this.nearId)?.agent ?? null : null; }
  resetView() { this.zoom = 1; this.resize(); }
  private canMove(x: number, z: number) {
    if (Math.abs(x) > this.roomWidth / 2 - 0.6 || Math.abs(z) > this.roomDepth / 2 - 0.6) return false;
    return !this.colliders.some(r => Math.abs(x - r.x) < r.w / 2 + 0.32 && Math.abs(z - r.z) < r.d / 2 + 0.32);
  }
  private keydown = (e: KeyboardEvent) => {
    if (this.paused || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if ((key === ' ' || key === 'enter') && e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'q', '1', 'e'].includes(key)) e.preventDefault();
    this.keys.add(key);
    if (!e.repeat && (key === 'q' || key === '1')) this.toggleEquipped();
    if (!e.repeat && key === 'e') this.callbacks.interact();
  };
  private keyup = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private blur = () => this.keys.clear();
  private pointermove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); this.moved = true;
  };
  private pointerdown = (e: PointerEvent) => { if (e.button === 0 && !this.paused) { this.pointermove(e); this.renderer.domElement.focus({ preventScroll: true }); if (this.equipped) this.fire(); } };
  private wheel = (e: WheelEvent) => { if (!this.paused) { e.preventDefault(); this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * -0.0006, 0.7, 1.8); this.resize(); } };
  private fire() {
    const now = performance.now(); if (now - this.lastFire < 680) return; this.lastFire = now;
    this.updateAim();
    const from = this.player.root.position.clone().add(new THREE.Vector3(0, 1.18, 0));
    const dir = this.aimPoint.clone().sub(this.player.root.position); dir.y = 0; dir.normalize();
    if (!dir.lengthSq()) return;
    this.player.root.rotation.y = Math.atan2(-dir.x, -dir.z);
    const targetRay = new THREE.Raycaster(from, dir, 0, 36);
    const agentMeshes: THREE.Object3D[] = [];
    for (const person of this.people.values()) person.root.traverse(o => { if (o instanceof THREE.Mesh && o !== person.ring) agentMeshes.push(o); });
    const hits = targetRay.intersectObjects([...agentMeshes, ...this.blockers], false);
    const hit = hits[0];
    const end = hit ? hit.point : from.clone().addScaledVector(dir, 30);
    for (let i = 0; i < 5; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.24);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from.clone().addScaledVector(dir, 0.8), end.clone().add(spread)]), new THREE.LineBasicMaterial({ color: 0xf4bd52, transparent: true, opacity: 0.9 }));
      this.scene.add(line); this.effects.push({ object: line, time: 0, lifetime: 0.14 });
    }
    const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), new THREE.MeshBasicMaterial({ color: 0xffdda1 }));
    flash.position.copy(from).addScaledVector(dir, 1); this.scene.add(flash); this.effects.push({ object: flash, time: 0, lifetime: 0.09 });
    this.gun.position.z = -0.08; this.playShot();
    const id = hit?.object.userData.agentId;
    if (id) { const person = this.people.get(id); if (person) this.callbacks.shoot(person.agent); }
  }
  private playShot() {
    try {
      this.audio ??= new AudioContext(); void this.audio.resume();
      const duration = 0.16; const buffer = this.audio.createBuffer(1, this.audio.sampleRate * duration, this.audio.sampleRate);
      const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
      const noise = this.audio.createBufferSource(); noise.buffer = buffer;
      const gain = this.audio.createGain(); gain.gain.value = 0.13; noise.connect(gain); gain.connect(this.audio.destination); noise.start();
    } catch { /* Audio is optional. */ }
  }
  private updateAim() {
    if (this.moved) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const meshes: THREE.Object3D[] = [];
      for (const person of this.people.values()) person.root.traverse(o => { if (o instanceof THREE.Mesh && o !== person.ring) meshes.push(o); });
      const hovered = this.raycaster.intersectObjects(meshes, false)[0];
      const person = hovered ? this.people.get(hovered.object.userData.agentId) : null;
      if (person) this.aimPoint.copy(person.root.position).setY(0);
      else this.raycaster.ray.intersectPlane(this.ground, this.aimPoint);
    }
    this.aim.position.set(this.aimPoint.x, 0.08, this.aimPoint.z);
  }
  private animate = () => {
    const now = performance.now(); const dt = Math.min((now - this.lastTick) / 1000, 0.04); this.lastTick = now; this.elapsed += dt; const time = this.elapsed;
    const move = new THREE.Vector3();
    if (!this.paused) {
      const forward = Number(this.keys.has('w') || this.keys.has('arrowup')) - Number(this.keys.has('s') || this.keys.has('arrowdown'));
      const side = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
      // Controls follow screen directions, making the isometric camera immediately usable.
      move.set(side * 0.79 - forward * 0.61, 0, -side * 0.61 - forward * 0.79).normalize().multiplyScalar(dt * (this.keys.has('shift') ? 7 : 4.5));
      const pos = this.player.root.position;
      if (this.canMove(pos.x + move.x, pos.z)) pos.x += move.x;
      if (this.canMove(pos.x, pos.z + move.z)) pos.z += move.z;
      if (move.lengthSq()) { this.focusTarget = null; this.player.root.rotation.y = Math.atan2(-move.x, -move.z); }
      this.updateAim();
      if (this.equipped && this.moved) this.player.root.rotation.y = Math.atan2(pos.x - this.aimPoint.x, pos.z - this.aimPoint.z);
    }
    const walking = move.lengthSq() > 0;
    this.player.leftLeg.rotation.x = walking ? Math.sin(time * 13) * 0.47 : 0;
    this.player.rightLeg.rotation.x = -this.player.leftLeg.rotation.x;
    this.player.leftArm.rotation.x = this.equipped ? 1.15 : -this.player.leftLeg.rotation.x;
    this.player.rightArm.rotation.x = this.equipped ? 1.3 : this.player.leftLeg.rotation.x;
    this.gun.position.z = THREE.MathUtils.lerp(this.gun.position.z, -0.24, dt * 14);
    let closest: AgentPerson | null = null; let closestDistance = 2.6;
    for (const person of this.people.values()) {
      const distance = person.root.position.distanceTo(this.player.root.position);
      if (distance < closestDistance) { closest = person; closestDistance = distance; }
      const t = time + person.phase;
      const next = person.path[0];
      const isWalking = !!next;
      if (next) {
        const direction = next.clone().sub(person.root.position); const dist = direction.length();
        if (dist < 0.07) person.path.shift(); else { person.root.position.addScaledVector(direction.normalize(), Math.min(dt * 2.2, dist)); person.root.rotation.y = Math.atan2(-direction.x, -direction.z); }
      }
      person.leftLeg.rotation.x = isWalking ? Math.sin(t * 11) * 0.45 : 0;
      person.rightLeg.rotation.x = -person.leftLeg.rotation.x;
      person.head.rotation.set(0, 0, 0);
      person.leftArm.rotation.set(isWalking ? -person.leftLeg.rotation.x : 0, 0, 0);
      person.rightArm.rotation.set(isWalking ? person.leftLeg.rotation.x : 0, 0, 0);
      person.cup.visible = !isWalking && (person.agent.status === 'idle' || person.agent.status === 'done');
      if (!isWalking) {
        if (person.agent.status === 'working') {
          person.root.rotation.y = 0; person.leftArm.rotation.x = 1.8 + Math.sin(t * 8) * 0.07; person.rightArm.rotation.x = 1.85 + Math.cos(t * 9) * 0.07;
          person.head.rotation.x = 0.1; person.root.position.y = -0.15;
        } else if (person.agent.status === 'blocked') {
          person.root.rotation.y = 0.22; person.leftArm.rotation.set(2.65, 0, 0.32); person.rightArm.rotation.set(2.65, 0, -0.32); person.head.rotation.x = 0.3 + Math.sin(t * 2) * 0.09; person.root.position.y = -0.08;
        } else {
          person.root.rotation.y = -0.4 + Math.sin(t * 0.3) * 0.35; person.rightArm.rotation.x = 0.95 + Math.max(0, Math.sin(t * 0.8)) * 0.7; person.root.position.y = Math.sin(t * 2) * 0.018;
        }
      } else person.root.position.y = Math.abs(Math.sin(t * 11)) * 0.04;
      const selected = this.focusTarget === person.agent.id || this.nearId === person.agent.id;
      person.label.visible = selected || this.people.size <= 8 || (person.agent.status === 'blocked' && this.people.size < 22);
      (person.ring.material as THREE.MeshBasicMaterial).opacity = selected ? 0.9 : person.agent.status === 'blocked' ? 0.38 : 0;
      (person.ring.material as THREE.MeshBasicMaterial).color.setHex(person.agent.status === 'blocked' ? C.red : C.lime);
    }
    const nextId = closest?.agent.id ?? null;
    if (nextId !== this.nearId) { this.nearId = nextId; this.callbacks.near(closest?.agent ?? null); }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]; effect.time += dt;
      if (effect.time >= effect.lifetime) {
        this.scene.remove(effect.object); this.disposeObject(effect.object);
        effect.object.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) { const material = o.material; if (Array.isArray(material)) material.forEach(m => m.dispose()); else material.dispose(); } });
        this.effects.splice(i, 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };
  private resize() {
    if (!this.renderer) return;
    const width = this.container.clientWidth; const height = this.container.clientHeight; if (!width || !height) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const half = Math.max(this.roomDepth * 0.66, this.roomWidth * 0.65 / aspect, 15.5) / this.zoom;
    this.camera.left = -half * aspect; this.camera.right = half * aspect; this.camera.top = half; this.camera.bottom = -half;
    this.camera.position.set(28, 34, 36); this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
  }
  private disposeObject(object: THREE.Object3D) {
    object.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
      if (o instanceof THREE.Sprite) { const material = o.material as THREE.SpriteMaterial; material.map?.dispose(); material.dispose(); }
    });
  }
  debugSnapshot() {
    const screen = (p: THREE.Vector3) => { const v = p.clone().project(this.camera); return { x: (v.x + 1) / 2 * this.container.clientWidth, y: (1 - v.y) / 2 * this.container.clientHeight }; };
    return { player: { position: this.player.root.position.toArray(), screen: screen(this.player.root.position) }, agents: [...this.people.values()].map(p => ({ id: p.agent.id, status: p.agent.status, position: p.root.position.toArray(), screen: screen(p.root.position.clone().add(new THREE.Vector3(0, 1.2, 0))) })), nearId: this.nearId, equipped: this.equipped, paused: this.paused, room: { width: this.roomWidth, depth: this.roomDepth }, colliders: this.colliders.map(r => ({ ...r })) };
  }
  dispose() {
    this.renderer.setAnimationLoop(null); this.observer.disconnect();
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup); window.removeEventListener('blur', this.blur);
    this.disposeObject(this.scene); this.renderer.dispose(); void this.audio?.close();
  }
}
