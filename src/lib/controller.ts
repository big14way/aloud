import type { ApplianceStep, Metrics, Mode, RouteResponse, SeeRequest, SeeResponse, SeeSkill } from "../../shared/api";
import { THRESHOLDS } from "../../shared/config";
import { encouragement, stepTurn } from "../../shared/easy";
import { answerFind, isPlural, matchObjects, type MemEvent, type MemObject } from "../../shared/memory";
import { type RouteDecision, refusalFor, routeByRules } from "../../shared/router";
import { api } from "./api";
import { Camera, encodeFrame, loadImage, simulatedSecondFrame, thumbnail } from "./camera";
import { Earcons } from "./earcons";
import { Listener, listeningSupported } from "./listener";
import { MemoryStore } from "./memory-store";
import { readOffline } from "./ocr";
import { type Sample, cachedAnswer, sampleDataUrl } from "./samples";
import { newId } from "./session";
import type { Settings } from "./settings";
import { Speaker } from "./speaker";

// The controller turns presses and spoken requests into skills. It owns the flows
// that take more than one press (learning an object, appliance steps, simple-mode
// plans, checking a remembered place) and keeps the visible state for the UI.

export type Pending =
  | { type: "enrol"; label: string; step: 0 | 1 | 2 | 3; thumbs: string[]; description: string }
  | { type: "appliance_label"; task: string }
  | { type: "appliance_steps"; modelNumber: string; steps: ApplianceStep[]; index: number }
  | { type: "plan"; steps: string[]; index: number }
  | { type: "check"; objectId: string; label: string; location: string; look: boolean; expires: number };

export type AnswerSource = "live" | "saved" | "offline" | "on_device";

export interface UiState {
  busy: string | null;
  listening: boolean;
  speaking: boolean;
  lastText: string[];
  lastMetrics: Metrics | null;
  lastSource: AnswerSource | null;
  lastFlags: string[];
  heard: string;
  pending: Pending | null;
  camera: "off" | "on" | "denied" | "unsupported";
  sample: Sample | null;
  simulatedSecondFrame: boolean;
  memoryVersion: number;
}

export const HELP_TEXT = [
  "Tap anywhere to hear what's in front of you. Double-tap to repeat. Hold to talk.",
  "You can say: read this, what is this, where are my keys, I'm putting my keys on the shelf, remember this as my keys, or help me use this microwave.",
];

const YES = /^\s*(yes|yeah|yep|yup|correct|right|sure|ok(ay)?|save( it)?|that'?s right|it worked|done)\b/i;
const NO = /^\s*(no|nope|wrong|not really|it didn'?t( work)?)\b/i;
const CANCEL = /^\s*(cancel|stop( this)?|quit|exit|never ?mind)\b/i;
const NEXT = /^\s*(next|skip|next step)\b/i;
const AGAIN = /^\s*(repeat|again|say (it|that) again)\b/i;

const CHECK_WINDOW_MS = 2 * 60_000;

function pronoun(label: string): string {
  return isPlural(label) ? "them" : "it";
}

function stripPreposition(location: string): string {
  return location.replace(/^(on top of|on|in|inside|under|underneath|next to|behind|beside|at|by)\s+/i, "");
}

/** "house keys" -> ["keys"] so "where are my keys" finds every set of keys. */
function aliasesFor(label: string): string[] {
  const words = label.trim().toLowerCase().split(/\s+/);
  return words.length > 1 ? [words[words.length - 1]!] : [];
}

export class Controller {
  readonly camera = new Camera();
  readonly speaker = new Speaker();
  readonly earcons = new Earcons();
  readonly listener = new Listener();
  readonly store = new MemoryStore();

  private settings: Settings;
  private listeners = new Set<() => void>();
  private lastFrames: string[] = [];
  private lastSkill: "describe" | "read" | "what_is" | null = null;
  private sampleFrame: string | null = null;
  private sampleFrame2: string | null = null;
  /** Resolves when the chosen sample photo is ready; actions wait for it instead of using the camera. */
  private sampleReady: Promise<void> | null = null;
  private unlocked = false;
  /** True while a capture-and-answer action runs; further presses are ignored, not queued. */
  private working = false;
  private nudged = false;
  /** Bumped whenever a flow starts or is cancelled, so late results of an old flow are dropped. */
  private flowEpoch = 0;

  state: UiState = {
    busy: null,
    listening: false,
    speaking: false,
    lastText: [],
    lastMetrics: null,
    lastSource: null,
    lastFlags: [],
    heard: "",
    pending: null,
    camera: Camera.supported() ? "off" : "unsupported",
    sample: null,
    simulatedSecondFrame: false,
    memoryVersion: 0,
  };

  constructor(settings: Settings) {
    this.settings = settings;
    this.applySettings(settings);
    this.speaker.onSpeakingChange = (speaking) => {
      this.earcons.setPaused(speaking);
      this.set({ speaking });
    };
  }

  // --- state plumbing -------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): UiState => this.state;

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.speaker.setOptions({ mode: s.answerMode, rate: s.rate, voiceURI: s.voiceURI });
    this.earcons.enabled = s.earcons;
  }

  private get mode(): Mode {
    return this.settings.simpleMode ? "simple" : "standard";
  }

  /** Audio and speech can only start from a user gesture on iOS. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.earcons.unlock();
    this.speaker.unlock();
  }

  say(sentences: string[], source: AnswerSource | null = null, metrics: Metrics | null = null, flags: string[] = []): void {
    this.speaker.say(sentences);
    this.set({ lastText: sentences, lastSource: source, lastMetrics: metrics, lastFlags: flags });
  }

  private buzz(): void {
    if (this.settings.haptics && "vibrate" in navigator) navigator.vibrate?.(30);
  }

  private async busy<T>(label: string, work: () => Promise<T>): Promise<T> {
    this.set({ busy: label });
    this.earcons.startThinking();
    try {
      return await work();
    } finally {
      this.earcons.stopThinking();
      this.set({ busy: null });
    }
  }

  /** One capture-and-answer action at a time. A second press while one runs is ignored. */
  private async exclusive(work: () => Promise<void>): Promise<void> {
    if (this.working) {
      if (!this.nudged) this.speaker.say(["One moment."], false);
      this.nudged = true;
      return;
    }
    this.working = true;
    this.nudged = false;
    try {
      await work();
    } finally {
      this.working = false;
    }
  }

  /** Sets a new flow (or none) and invalidates results still on their way for the old one. */
  private setFlow(pending: Pending | null): void {
    this.flowEpoch++;
    this.set({ pending });
  }

  // --- frames ---------------------------------------------------------------

  async useSample(sample: Sample | null): Promise<void> {
    if (!sample) {
      this.sampleFrame = null;
      this.sampleFrame2 = null;
      this.sampleReady = null;
      this.set({ sample: null, simulatedSecondFrame: false });
      return;
    }
    // The camera is released while a sample photo stands in for it.
    this.stopCamera();
    this.sampleFrame = null;
    this.sampleFrame2 = null;
    this.set({ sample, simulatedSecondFrame: false });
    const toFrame = async (file: string) => {
      const img = await loadImage(await sampleDataUrl(file));
      return encodeFrame(img, img.naturalWidth, img.naturalHeight);
    };
    const ready = (async () => {
      const [first, second] = await Promise.all([toFrame(sample.file), toFrame(`frame2/${sample.file}`).catch(() => null)]);
      // Ignore a load that finished after another sample (or the camera) was chosen.
      if (this.state.sample?.id !== sample.id) return;
      this.sampleFrame = first;
      this.sampleFrame2 = second;
    })();
    this.sampleReady = ready.catch(() => {
      if (this.state.sample?.id === sample.id) this.set({ sample: null });
    });
    await this.sampleReady;
    if (this.state.sample?.id === sample.id && this.sampleFrame) {
      this.speaker.say([`Sample photo: ${sample.title}. Press the button, or choose a skill.`], false);
    } else if (this.state.sample === null) {
      this.say(["That sample photo didn't load. Please try another, or use the camera."]);
    }
  }

  async startCamera(): Promise<boolean> {
    if (this.state.camera === "unsupported") return false;
    const ok = await this.camera.start();
    this.set({ camera: ok ? "on" : "denied" });
    return ok;
  }

  stopCamera(): void {
    this.camera.stop();
    if (this.state.camera === "on") this.set({ camera: "off" });
  }

  /** One frame, or two ~400 ms apart. Returns null (and says why) when there is no picture. */
  private async frames(count: 1 | 2): Promise<string[] | null> {
    if (this.sampleReady) await this.sampleReady;
    if (this.sampleFrame) {
      if (count === 1) return [this.sampleFrame];
      this.set({ simulatedSecondFrame: true });
      return [this.sampleFrame, this.sampleFrame2 ?? (await simulatedSecondFrame(this.sampleFrame))];
    }
    this.set({ simulatedSecondFrame: false });
    if (!(await this.startCamera())) {
      this.earcons.error();
      this.say([
        this.state.camera === "unsupported" ? "This browser has no camera access." : "I can't use the camera. Check the camera permission, or try the sample photos.",
      ]);
      return null;
    }
    try {
      return count === 2 ? await this.camera.captureTwo() : [await this.camera.capture()];
    } catch {
      this.say(["The camera isn't ready yet. Please press again."]);
      return null;
    }
  }

  // --- vision skills --------------------------------------------------------

  private async see(skill: SeeSkill, frames: string[], extra: Partial<SeeRequest> = {}): Promise<SeeResponse | null> {
    const res = await api.see({ skill, frames, mode: this.mode, ...extra });
    if (res.ok) return res.data;
    // Read still works offline, on the device.
    if (res.offline && skill === "read") {
      const offline = await readOffline(frames).catch(() => null);
      if (offline) {
        this.earcons.done();
        this.say(offline.speech, "on_device");
        return null;
      }
    }
    if (this.state.sample) {
      const saved = await cachedAnswer(this.state.sample.id, skill, this.mode);
      if (saved) {
        this.earcons.done();
        this.say([...saved.speech, "That was a saved answer from an earlier run."], "saved", saved.metrics);
        return null;
      }
    }
    this.earcons.error();
    const offlineHelp = res.offline && skill !== "read" ? ["I can still read text and find your things offline."] : [];
    this.say([...res.error.speech, ...offlineHelp], res.offline ? "offline" : null);
    return null;
  }

  look(skill: "describe" | "read" | "what_is"): Promise<void> {
    this.unlock();
    return this.exclusive(() => this.doLook(skill));
  }

  private async doLook(skill: "describe" | "read" | "what_is", lookHarder = false): Promise<void> {
    const frames = lookHarder && this.lastFrames.length > 0 ? this.lastFrames : await this.frames(skill === "read" ? 2 : 1);
    if (!frames) return;
    if (!lookHarder) {
      this.earcons.capture();
      this.buzz();
    }
    this.lastFrames = frames;
    this.lastSkill = skill;
    const label = skill === "read" ? "Reading" : skill === "what_is" ? "Looking at it" : "Looking";
    const res = await this.busy(lookHarder ? "Looking harder" : label, () => this.see(skill, frames, { look_harder: lookHarder }));
    if (!res) return;
    this.earcons.done();
    this.say(res.speech, "live", res.metrics, res.flags);
  }

  async lookHarder(): Promise<void> {
    if (!this.lastSkill || this.lastFrames.length === 0) {
      this.say(["Press the button first, then ask me to look harder."]);
      return;
    }
    const skill = this.lastSkill;
    await this.exclusive(async () => {
      this.speaker.say(["Looking more carefully. This takes a few seconds."], false);
      await this.doLook(skill, true);
    });
  }

  // --- the main button ------------------------------------------------------

  /** Tap, Space, or a clicker: continue the current flow, or describe. */
  primary(): Promise<void> {
    this.unlock();
    return this.exclusive(async () => {
      this.speaker.stop();
      const p = this.state.pending;
      if (!p) return this.doLook("describe");
      switch (p.type) {
        case "enrol":
          return p.step === 3 ? this.confirmEnrol() : this.enrolCapture(p);
        case "appliance_label":
          return this.readApplianceLabel(p);
        case "appliance_steps":
          return this.checkApplianceStep(p);
        case "plan":
          return this.nextPlanStep(p);
        case "check":
          // Checks belong to the Find button; the main button goes back to describing.
          this.setFlow(null);
          return this.doLook("describe");
      }
    });
  }

  repeat(): void {
    this.unlock();
    this.speaker.repeat();
  }

  stop(): void {
    this.speaker.stop();
    this.listener.cancel();
    this.set({ listening: false });
  }

  cancelFlow(): void {
    if (!this.state.pending) return;
    this.setFlow(null);
    this.say(["OK, stopped."]);
  }

  // --- talking --------------------------------------------------------------

  canListen(): boolean {
    return listeningSupported();
  }

  startListening(): boolean {
    this.unlock();
    this.speaker.stop();
    const ok = this.listener.start({
      onText: (text) => void this.handleUtterance(text),
      onEnd: () => this.set({ listening: false }),
      onError: () => {
        this.set({ listening: false });
        this.say(["I couldn't hear that. You can also type your request."]);
      },
    });
    if (ok) {
      this.earcons.listening();
      this.set({ listening: true });
    }
    return ok;
  }

  stopListening(): void {
    this.listener.stop();
  }

  async handleUtterance(text: string): Promise<void> {
    const utterance = text.trim();
    if (!utterance) return;
    this.set({ heard: utterance });
    if (await this.handleFlowReply(utterance)) return;

    const refusal = refusalFor(utterance);
    if (refusal) return this.dispatch(refusal);

    const snap = await this.store.snapshot();
    const known = snap.objects.map((o) => o.label);
    const res = await this.busy("Thinking", () =>
      api.route({ utterance, known_objects: known, appliance_active: this.state.pending?.type === "appliance_steps" }),
    );
    const decision: RouteDecision = res.ok ? (res.data as RouteResponse) : routeByRules(utterance, known);
    await this.dispatch(decision);
  }

  /** Short replies inside a flow: yes, no, next, repeat, cancel. */
  private async handleFlowReply(u: string): Promise<boolean> {
    const p = this.state.pending;
    if (!p) return false;
    if (CANCEL.test(u)) {
      this.cancelFlow();
      return true;
    }
    if (AGAIN.test(u)) {
      this.speaker.repeat();
      return true;
    }
    switch (p.type) {
      case "enrol":
        if (p.step === 3 && YES.test(u)) return this.confirmEnrol().then(() => true);
        if (NO.test(u)) {
          this.setFlow(null);
          this.say([`OK, I won't save it.`]);
          return true;
        }
        return false;
      case "plan":
        if (YES.test(u) || NEXT.test(u)) return this.nextPlanStep(p).then(() => true);
        if (NO.test(u)) {
          this.say(["That's OK. Let's try again.", ...stepTurn(p.steps[p.index]!, p.index, p.steps.length, this.settings.userName)]);
          return true;
        }
        return false;
      case "appliance_steps":
        if (NEXT.test(u) || YES.test(u)) return this.advanceAppliance(p).then(() => true);
        return false;
      default:
        return false;
    }
  }

  async dispatch(d: RouteDecision): Promise<void> {
    if (d.outcome !== "success") {
      if (d.outcome === "fatal") this.earcons.error();
      this.say(d.speech);
      return;
    }
    const a = d.args;
    switch (d.skill) {
      case "describe":
      case "read":
      case "what_is":
        return this.look(d.skill);
      case "find":
        return this.find(a.object ?? "");
      case "remember_placement":
        return this.remember(a.object ?? "", a.location ?? "");
      case "picked_up":
        return this.pickedUp(a.object ?? "");
      case "enrol_object":
        return this.startEnrol(a.label ?? "");
      case "appliance_help":
        return this.startAppliance(a.task ?? "use it");
      case "plan_task":
        return this.startPlan(a.goal ?? "");
      case "repeat":
        return this.repeat();
      case "stop":
        return this.stop();
      case "look_harder":
        return this.lookHarder();
      case "help":
        return this.say(HELP_TEXT);
      case "refuse":
      case "unsupported":
        return this.say(d.speech);
    }
  }

  // --- memory ---------------------------------------------------------------

  private bumpMemory(): void {
    this.set({ memoryVersion: this.state.memoryVersion + 1 });
  }

  async knownObjects(): Promise<MemObject[]> {
    return (await this.store.snapshot()).objects;
  }

  /** Find button: a second press within two minutes checks with the camera. */
  async findButton(): Promise<void> {
    this.unlock();
    const p = this.state.pending;
    if (p?.type === "check" && Date.now() <= p.expires) return this.exclusive(() => this.runCheck(p));
    const objects = await this.knownObjects();
    if (objects.length === 1) return this.find(objects[0]!.label);
    if (objects.length === 0) {
      this.say(["I don't know any of your things yet. Hold one up and say: remember this as my keys."]);
      return;
    }
    const how = this.canListen() ? "Press Talk and say its name" : "Type its name";
    this.say([`Which object? ${how}. I know: ${objects.map((o) => o.label).join(", ")}.`]);
  }

  async find(query: string): Promise<void> {
    const snap = await this.store.snapshot();
    const ans = answerFind(query, snap.objects, snap.events, Date.now());
    const speech = [ans.speech];
    const obj = ans.object_ids.length === 1 ? snap.objects.find((o) => o.id === ans.object_ids[0]) : undefined;
    // Offer a camera check, unless another flow (learning, appliance, plan) is under way.
    const free = !this.state.pending || this.state.pending.type === "check";
    if (obj && obj.thumbs.length > 0 && free) {
      const them = pronoun(obj.label);
      const last = [...snap.events].reverse().find((e) => e.object_id === obj.id && e.location && (e.kind === "placed" || e.kind === "seen"));
      if ((ans.answer_status === "confirmed" || ans.answer_status === "last_confirmed_only") && last) {
        speech.push(`To check, point the camera at ${stripPreposition(last.location)} and press Find again.`);
        this.setFlow({ type: "check", objectId: obj.id, label: obj.label, location: last.location, look: false, expires: Date.now() + CHECK_WINDOW_MS });
      } else if (ans.answer_status === "unknown") {
        if (!ans.speech.includes("press Find")) speech.push(`Point the camera around and press Find to look for ${them}.`);
        this.setFlow({ type: "check", objectId: obj.id, label: obj.label, location: "", look: true, expires: Date.now() + CHECK_WINDOW_MS });
      }
    }
    this.say(speech, "on_device");
  }

  private async runCheck(p: Extract<Pending, { type: "check" }>): Promise<void> {
    const snap = await this.store.snapshot();
    const obj = snap.objects.find((o) => o.id === p.objectId);
    if (!obj) {
      this.setFlow(null);
      return;
    }
    const frames = await this.frames(1);
    if (!frames) return;
    this.earcons.capture();
    this.buzz();
    const res = await this.busy(`Looking for your ${obj.label}`, () =>
      this.see("match", frames, { references: obj.thumbs.slice(0, 3), context: { label: obj.label, description: obj.description } }),
    );
    if (!res?.match) return;
    const m = res.match;
    // Guidance (blur, too dark) means the structured fields can't be trusted: speak it, store nothing.
    if (res.status !== "answered" || !m.can_answer) {
      this.say(res.speech, "live", res.metrics);
      return;
    }
    if (!p.look) {
      if (m.visible && m.confidence >= THRESHOLDS.trust) {
        await this.addEvent({ object_id: obj.id, kind: "seen", location: p.location, source: "vision", confidence: m.confidence, identity_confidence: m.confidence });
        this.say([...res.speech, `Confirmed ${p.location}.`], "live", res.metrics);
      } else if (!m.visible && m.confidence >= THRESHOLDS.trust) {
        await this.addEvent({ object_id: obj.id, kind: "missing", location: p.location, source: "vision", confidence: m.confidence, identity_confidence: null });
        this.say([...res.speech, `I'll stop saying ${isPlural(obj.label) ? "they are" : "it is"} there.`], "live", res.metrics);
      } else {
        this.say(res.speech, "live", res.metrics);
      }
    } else {
      this.say(res.speech, "live", res.metrics);
    }
    this.earcons.done();
  }

  private async addEvent(e: Omit<MemEvent, "id" | "ts" | "place_id">): Promise<void> {
    await this.store.addEvent({ ...e, id: newId(), ts: Date.now(), place_id: null });
    this.bumpMemory();
  }

  private async resolveObject(name: string): Promise<MemObject | null> {
    const objects = await this.knownObjects();
    const matches = matchObjects(name, objects);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      this.say([`Which one: ${matches.map((m) => m.label).join(", or ")}?`]);
      return null;
    }
    const them = pronoun(name);
    this.say([`I don't know your ${name} yet. Point the camera at ${them} and say: remember this as my ${name}.`]);
    return null;
  }

  remember(object: string, location: string): Promise<void> {
    return this.exclusive(() => this.doRemember(object, location));
  }

  private async doRemember(object: string, location: string): Promise<void> {
    const obj = await this.resolveObject(object);
    if (!obj) return;
    const them = pronoun(obj.label);
    let identity: number | null = null;
    let metrics: Metrics | null = null;
    const frames = obj.thumbs.length > 0 ? await this.frames(1) : null;
    if (frames) {
      this.earcons.capture();
      const res = await this.busy(`Checking your ${obj.label}`, () =>
        api.see({ skill: "match", frames, references: obj.thumbs.slice(0, 3), mode: this.mode, context: { label: obj.label, description: obj.description } }),
      );
      // Only an answered, usable match counts; guidance leaves the placement unconfirmed.
      if (res.ok && res.data.match && res.data.status === "answered" && res.data.match.can_answer) {
        identity = res.data.match.visible ? res.data.match.confidence : 0;
        metrics = res.data.metrics;
      }
    }
    await this.addEvent({ object_id: obj.id, kind: "placed", location, source: "user_said", confidence: 1, identity_confidence: identity });
    this.earcons.done();
    if (identity !== null && identity >= THRESHOLDS.trust) {
      this.say([`Got it. Your ${obj.label}: ${location}, confirmed.`], "live", metrics);
    } else if (identity === null) {
      this.say([`I've noted your ${obj.label} ${location}, but I couldn't check with the camera, so it isn't confirmed.`], "on_device");
    } else {
      this.say([`I've noted your ${obj.label} ${location}, but I couldn't see ${them} to confirm. Point the camera at ${them} and say it again.`], "live", metrics);
    }
  }

  async pickedUp(object: string): Promise<void> {
    const obj = await this.resolveObject(object);
    if (!obj) return;
    await this.addEvent({ object_id: obj.id, kind: "picked_up", location: "", source: "user_said", confidence: 1, identity_confidence: null });
    this.say([`OK. You have your ${obj.label}.`], "on_device");
  }

  startEnrol(label: string): void {
    const name = label.trim();
    if (!name) {
      this.say(["What should I call it? Say: remember this as my keys."]);
      return;
    }
    const them = pronoun(name);
    this.setFlow({ type: "enrol", label: name, step: 0, thumbs: [], description: "" });
    this.say([`Let's learn your ${name}. Hold ${them} about an arm's length from the camera, on a plain surface if you can, and press the button.`]);
  }

  private async enrolCapture(p: Extract<Pending, { type: "enrol" }>): Promise<void> {
    const frames = await this.frames(1);
    if (!frames) return;
    this.earcons.capture();
    this.buzz();
    const them = pronoun(p.label);
    const thumb = await thumbnail(frames[0]!);
    if (this.state.pending !== p) return;
    if (p.step === 0) {
      const res = await this.busy("Learning", () => this.see("enrol", frames, { context: { label: p.label } }));
      // Cancelled or replaced while waiting: drop the late result.
      if (!res || this.state.pending !== p) return;
      if (res.status !== "answered" || !res.enrol) {
        if (res.status === "refused") this.setFlow(null);
        this.say(res.speech, "live", res.metrics);
        return;
      }
      this.set({ pending: { ...p, step: 1, thumbs: [thumb], description: res.enrol.description } });
      this.earcons.done();
      this.say([`Good. Now turn ${them} over and press the button.`], "live", res.metrics);
      return;
    }
    if (p.step === 1) {
      this.set({ pending: { ...p, step: 2, thumbs: [...p.thumbs, thumb] } });
      this.say([`Now hold ${them} sideways and press the button.`]);
      return;
    }
    const description = p.description.replace(/[\s.]+$/, "");
    this.set({ pending: { ...p, step: 3, thumbs: [...p.thumbs, thumb] } });
    this.say([`I see ${description.charAt(0).toLowerCase()}${description.slice(1)}.`, `Should I remember this as your ${p.label}? Press the button for yes, or say no.`]);
  }

  private async confirmEnrol(): Promise<void> {
    const p = this.state.pending;
    if (p?.type !== "enrol") return;
    const obj: MemObject = { id: newId(), label: p.label, aliases: aliasesFor(p.label), description: p.description, thumbs: p.thumbs.slice(0, 3), created_ts: Date.now() };
    await this.store.putObject(obj);
    this.bumpMemory();
    this.setFlow(null);
    this.earcons.done();
    this.say([`Saved. I'll remember your ${p.label}.`, `When you put ${pronoun(p.label)} down, tell me, like: I'm putting my ${p.label} on the shelf.`], "on_device");
  }

  async deleteObject(id: string): Promise<void> {
    await this.store.deleteObject(id);
    this.bumpMemory();
  }

  async deleteAllMemory(): Promise<void> {
    await this.store.deleteAll();
    this.bumpMemory();
    this.say(["All memory on this phone is deleted."]);
  }

  // --- appliance helper -----------------------------------------------------

  startAppliance(task: string): void {
    this.setFlow({ type: "appliance_label", task });
    this.say(["Point the camera at the model label. It's usually on the back, the side, or inside the door. Then press the button."]);
  }

  private async readApplianceLabel(p: Extract<Pending, { type: "appliance_label" }>): Promise<void> {
    const task = p.task;
    const frames = await this.frames(2);
    if (!frames) return;
    this.earcons.capture();
    this.buzz();
    const res = await this.busy("Reading the label", () => this.see("label", frames));
    if (!res || this.state.pending !== p) return;
    if (res.status !== "answered" || !res.label?.model_number_verified) {
      this.say(res.speech, "live", res.metrics, res.flags);
      return;
    }
    this.speaker.say([...res.speech, "Looking up the manual."], false);
    const l = res.label;
    const steps = await this.busy("Finding the manual", () =>
      api.appliance({ brand: l.brand, model_number: l.model_number, appliance_type: l.appliance_type, task, mode: this.mode }),
    );
    // Cancelled while the manual was being fetched: say nothing more.
    if (this.state.pending !== p) return;
    if (!steps.ok) {
      this.earcons.error();
      this.say(steps.error.speech);
      return;
    }
    this.earcons.done();
    if (!steps.data.found_instructions) {
      this.setFlow(null);
      this.say(steps.data.speech, "live", steps.data.metrics);
      return;
    }
    this.setFlow({ type: "appliance_steps", modelNumber: l.model_number, steps: steps.data.steps, index: 0 });
    this.say(steps.data.speech, "live", steps.data.metrics);
  }

  private stepSpeech(steps: ApplianceStep[], index: number): string[] {
    const s = steps[index]!;
    if (this.settings.simpleMode) return stepTurn(s.instruction, index, steps.length, this.settings.userName);
    return [`Step ${index + 1}: ${s.instruction}`];
  }

  private async checkApplianceStep(p: Extract<Pending, { type: "appliance_steps" }>): Promise<void> {
    const step = p.steps[p.index]!;
    const frames = await this.frames(1);
    if (!frames) return;
    this.earcons.capture();
    const res = await this.busy("Checking", () => this.see("step_check", frames, { context: { instruction: step.instruction, visual_check: step.visual_check } }));
    // Moved on ("next") or cancelled while checking: this result is about an old step.
    if (!res || this.state.pending !== p) return;
    const done = res.status === "answered" && res.step?.step_done === "yes" && res.step.confidence >= THRESHOLDS.trust;
    if (done) {
      this.earcons.done();
      return this.advanceAppliance(p, res.speech, res.metrics);
    }
    this.say([...res.speech, "When it's done, press the button again. Or say next to skip."], "live", res.metrics);
  }

  private async advanceAppliance(p: Extract<Pending, { type: "appliance_steps" }>, before: string[] = [], metrics: Metrics | null = null): Promise<void> {
    const next = p.index + 1;
    if (next >= p.steps.length) {
      this.setFlow(null);
      this.say([...before, "That was the last step. Well done."], "live", metrics);
      return;
    }
    this.setFlow({ ...p, index: next });
    this.say([...before, ...this.stepSpeech(p.steps, next)], "live", metrics);
  }

  // --- simple-mode plans ----------------------------------------------------

  startPlan(goal: string): Promise<void> {
    return this.exclusive(() => this.doStartPlan(goal));
  }

  private async doStartPlan(goal: string): Promise<void> {
    const epoch = ++this.flowEpoch;
    const frames = await this.frames(1);
    if (!frames) return;
    this.earcons.capture();
    this.buzz();
    const res = await this.busy("Making a plan", () => this.see("plan", frames, { context: { goal, user_name: this.settings.userName || undefined } }));
    // Another flow started or this one was cancelled while planning.
    if (!res || epoch !== this.flowEpoch) return;
    this.earcons.done();
    if (res.status === "answered" && res.plan && res.plan.steps.length > 0) this.setFlow({ type: "plan", steps: res.plan.steps, index: 0 });
    this.say(res.speech, "live", res.metrics);
  }

  private async nextPlanStep(p: Extract<Pending, { type: "plan" }>): Promise<void> {
    const next = p.index + 1;
    if (next >= p.steps.length) {
      this.setFlow(null);
      const name = this.settings.userName ? `, ${this.settings.userName}` : "";
      this.say([`All done${name}!`, encouragement(next)]);
      return;
    }
    this.setFlow({ ...p, index: next });
    this.say(stepTurn(p.steps[next]!, next, p.steps.length, this.settings.userName));
  }

  /** Label for the main button, so its purpose is always announced. */
  primaryLabel(): string {
    const p = this.state.pending;
    if (!p) return "What's in front of me";
    switch (p.type) {
      case "enrol":
        return p.step === 3 ? `Yes, save my ${p.label}` : `Capture ${p.label}, view ${p.step + 1} of 3`;
      case "appliance_label":
        return "Read the model label";
      case "appliance_steps":
        return `Check step ${p.index + 1} of ${p.steps.length}`;
      case "plan":
        return p.index + 1 < p.steps.length ? `It worked: go to step ${p.index + 2}` : "It worked: finish";
      case "check":
        return "What's in front of me";
    }
  }
}
