const STORAGE_KEY = "t3code:pet-companion:v2";

const SPRITE_COLUMNS = 8;
const SPRITE_ROWS = 9;
const IDLE_SLOWDOWN = 6;

const STATE_LABELS = {
  idle: "Idle",
  "running-right": "Run Right",
  "running-left": "Run Left",
  waving: "Waving",
  jumping: "Jumping",
  failed: "Failed",
  waiting: "Waiting",
  running: "Running",
  review: "Review",
};

const IDLE_FRAMES = [
  { rowIndex: 0, columnIndex: 0, frameDurationMs: 280 },
  { rowIndex: 0, columnIndex: 1, frameDurationMs: 110 },
  { rowIndex: 0, columnIndex: 2, frameDurationMs: 110 },
  { rowIndex: 0, columnIndex: 3, frameDurationMs: 140 },
  { rowIndex: 0, columnIndex: 4, frameDurationMs: 140 },
  { rowIndex: 0, columnIndex: 5, frameDurationMs: 320 },
];

const SLOWED_IDLE_FRAMES = IDLE_FRAMES.map((frame) => ({
  ...frame,
  frameDurationMs: frame.frameDurationMs * IDLE_SLOWDOWN,
}));

const FRAMES_BY_STATE = {
  failed: buildRowFrames(5, 8, 140, 240),
  idle: IDLE_FRAMES,
  jumping: buildRowFrames(4, 5, 140, 280),
  review: buildRowFrames(8, 6, 150, 280),
  running: buildRowFrames(7, 6, 120, 220),
  "running-left": buildRowFrames(2, 8, 120, 220),
  "running-right": buildRowFrames(1, 8, 120, 220),
  waving: buildRowFrames(3, 4, 140, 280),
  waiting: buildRowFrames(6, 6, 150, 260),
};

let animationTimer = null;
let animationGeneration = 0;
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

window.addEventListener("error", (event) => {
  event.preventDefault();
  renderFatalPetError();
});

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  renderFatalPetError();
});

function getDesktopHttpBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const configured = params.get("desktopHttpBaseUrl");
  if (configured) return configured;
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin;
  }
  return null;
}

function readSelectedPetId() {
  try {
    const settings = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof settings.selectedPetId === "string" ? settings.selectedPetId : null;
  } catch {
    return null;
  }
}

function resolvePetSpriteUrl(httpBaseUrl, pet) {
  return new URL(pet.spritesheetUrl, httpBaseUrl).toString();
}

function buildRowFrames(rowIndex, frameCount, frameDurationMs, finalFrameDurationMs) {
  return Array.from({ length: frameCount }, (_, columnIndex) => ({
    rowIndex,
    columnIndex,
    frameDurationMs: columnIndex === frameCount - 1 ? finalFrameDurationMs : frameDurationMs,
  }));
}

function positionForFrame(frame) {
  return `${(frame.columnIndex / (SPRITE_COLUMNS - 1)) * 100}% ${
    (frame.rowIndex / (SPRITE_ROWS - 1)) * 100
  }%`;
}

function resolvePlaybackFrames(stateId, reduceMotion) {
  const frames = FRAMES_BY_STATE[stateId] ?? FRAMES_BY_STATE.idle;
  if (reduceMotion) return { frames: [frames[0]], loopStartIndex: null };
  if (stateId === "idle") return { frames: SLOWED_IDLE_FRAMES, loopStartIndex: 0 };

  const activeFrames = [...frames, ...frames, ...frames];
  return {
    frames: [...activeFrames, ...SLOWED_IDLE_FRAMES],
    loopStartIndex: activeFrames.length,
  };
}

function stopPetAnimation() {
  animationGeneration += 1;
  if (animationTimer !== null) {
    window.clearTimeout(animationTimer);
    animationTimer = null;
  }
}

function startPetAnimation(stage, stateId, reduceMotion) {
  const sprite = stage.querySelector(".pet-sprite");
  if (!sprite) return;
  stopPetAnimation();

  const generation = animationGeneration;
  const playback = resolvePlaybackFrames(stateId, reduceMotion);
  let frameIndex = 0;

  const showNextFrame = () => {
    if (generation !== animationGeneration) return;
    const frame = playback.frames[frameIndex];
    if (!frame) return;
    sprite.style.backgroundPosition = positionForFrame(frame);
    if (playback.frames.length <= 1) return;

    animationTimer = window.setTimeout(() => {
      const nextIndex = frameIndex + 1;
      frameIndex = nextIndex < playback.frames.length ? nextIndex : (playback.loopStartIndex ?? 0);
      showNextFrame();
    }, frame.frameDurationMs);
  };

  showNextFrame();
}

function setPetState(stage, stateId) {
  const resolvedStateId = FRAMES_BY_STATE[stateId] ? stateId : "idle";
  if (stage.dataset.petState === resolvedStateId) return;
  stage.dataset.petState = resolvedStateId;
  stage.setAttribute("aria-label", `Codex pet: ${STATE_LABELS[resolvedStateId]}`);
  startPetAnimation(stage, resolvedStateId, reduceMotionQuery.matches);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return Math.abs(Math.round(value) - value) < 0.05
    ? `${Math.round(value)}%`
    : `${value.toFixed(1)}%`;
}

function colorForRemaining(remaining, role) {
  if (remaining <= 12) return "#ef4444";
  if (remaining <= 30) return "#f59e0b";
  return role === "primary" ? "#22c55e" : "#38bdf8";
}

function setRing(circle, bucket, role) {
  const radius = Number(circle.getAttribute("r"));
  const circumference = 2 * Math.PI * radius;
  const remaining = Math.max(0, Math.min(100, bucket?.remainingPercent ?? 0));
  circle.style.stroke = colorForRemaining(remaining, role);
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${circumference * (1 - remaining / 100)}`;
}

function updateUsageRings(wrapper, usage) {
  const rings = wrapper.querySelector(".usage-rings");
  const primary = wrapper.querySelector("[data-ring='primary']");
  const secondary = wrapper.querySelector("[data-ring='secondary']");
  if (!rings || !primary || !secondary) return;

  if (!usage?.primary && !usage?.secondary) {
    rings.classList.remove("is-visible");
    wrapper.removeAttribute("title");
    return;
  }

  rings.classList.add("is-visible");
  if (usage.primary) setRing(primary, usage.primary, "primary");
  if (usage.secondary) setRing(secondary, usage.secondary, "secondary");
  const titleParts = [
    usage.primary ? `Short ${formatPercent(usage.primary.remainingPercent)} remaining` : null,
    usage.secondary ? `Weekly ${formatPercent(usage.secondary.remainingPercent)} remaining` : null,
  ].filter(Boolean);
  wrapper.title = titleParts.join(" · ");
}

function setPetStatus(wrapper, status) {
  const card = wrapper.querySelector(".status-card");
  const title = wrapper.querySelector(".status-title");
  const detail = wrapper.querySelector(".status-detail");
  if (!card || !title || !detail) return;

  if (!status || typeof status !== "object") {
    wrapper.classList.remove("has-status");
    card.className = "status-card";
    title.textContent = "";
    detail.textContent = "";
    return;
  }

  const statusTitle = normalizeStatusText(status.title);
  const statusDetail = normalizeStatusText(status.detail);
  wrapper.classList.add("has-status");
  card.className = [
    "status-card",
    status.isLoading ? "is-loading" : "",
    status.state === "waiting" ? "is-waiting" : "",
    status.state === "failed" ? "is-failed" : "",
    status.state === "review" ? "is-review" : "",
  ]
    .filter(Boolean)
    .join(" ");
  title.textContent = statusTitle || "T3 Code";
  detail.textContent = statusDetail || statusLabelForState(status.state);
}

function normalizeStatusText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function statusLabelForState(state) {
  if (state === "waiting") return "Needs input";
  if (state === "failed") return "Something needs attention";
  if (state === "review") return "Ready for review";
  return "Working...";
}

function renderFatalPetError() {
  stopPetAnimation();
  const root = document.querySelector("#pet-root");
  if (root) renderEmpty(root, "Could not load local Codex pets.");
}

function renderEmpty(root, message) {
  root.replaceChildren();
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.textContent = message;
  root.append(emptyState);
}

function renderPet(root, httpBaseUrl, pets) {
  const selectedPetId = readSelectedPetId();
  const pet = pets.find((candidate) => candidate.id === selectedPetId) ?? pets[0];
  if (!pet) {
    renderEmpty(root, "No local Codex pet found.");
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "pet-wrap";

  const mascot = document.createElement("div");
  mascot.className = "mascot-wrap";

  const rings = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  rings.classList.add("usage-rings");
  rings.setAttribute("viewBox", "0 0 112 121");
  rings.setAttribute("aria-hidden", "true");
  rings.innerHTML = `
    <circle class="usage-ring-track" cx="56" cy="60.5" r="54" stroke-width="2.5"></circle>
    <circle data-ring="primary" class="usage-ring-value" cx="56" cy="60.5" r="54" stroke-width="2.5"></circle>
    <circle class="usage-ring-track" cx="56" cy="60.5" r="49" stroke-width="2"></circle>
    <circle data-ring="secondary" class="usage-ring-value" cx="56" cy="60.5" r="49" stroke-width="2"></circle>
  `;

  const stage = document.createElement("div");
  stage.className = "pet-stage";
  stage.style.setProperty("--sprite-url", `url("${resolvePetSpriteUrl(httpBaseUrl, pet)}")`);

  const sprite = document.createElement("div");
  sprite.className = "pet-sprite";
  stage.append(sprite);

  const statusCard = document.createElement("section");
  statusCard.className = "status-card";
  statusCard.setAttribute("aria-live", "polite");
  statusCard.innerHTML = `
    <div class="status-title"></div>
    <div class="status-detail"></div>
    <div class="status-spinner" aria-hidden="true"></div>
  `;

  mascot.append(rings, stage);
  wrapper.append(mascot, statusCard);
  root.replaceChildren(wrapper);

  setPetState(stage, "idle");

  const stopListening = window.desktopBridge?.onPetCompanionState?.((stateId) => {
    setPetState(stage, stateId);
  });
  const handleMotionPreferenceChange = () => {
    const stateId = stage.dataset.petState ?? "idle";
    delete stage.dataset.petState;
    setPetState(stage, stateId);
  };
  reduceMotionQuery.addEventListener("change", handleMotionPreferenceChange);
  const stopUsageListening = window.desktopBridge?.onPetCompanionUsage?.((usage) => {
    updateUsageRings(wrapper, usage);
  });
  const stopStatusListening = window.desktopBridge?.onPetCompanionStatus?.((status) => {
    if (status?.state) setPetState(stage, status.state);
    setPetStatus(wrapper, status);
  });
  window.desktopBridge?.getPetCompanionState?.().then((stateId) => {
    if (typeof stateId === "string") setPetState(stage, stateId);
  });
  window.desktopBridge?.getPetCompanionUsage?.().then((usage) => {
    updateUsageRings(wrapper, usage);
  });
  window.desktopBridge?.getPetCompanionStatus?.().then((status) => {
    if (status?.state) setPetState(stage, status.state);
    setPetStatus(wrapper, status);
  });
  window.addEventListener("beforeunload", () => {
    stopPetAnimation();
    reduceMotionQuery.removeEventListener("change", handleMotionPreferenceChange);
    stopListening?.();
    stopUsageListening?.();
    stopStatusListening?.();
  });
}

async function main() {
  const root = document.querySelector("#pet-root");
  const httpBaseUrl = getDesktopHttpBaseUrl();
  if (!root || !httpBaseUrl) return;

  try {
    const response = await fetch(new URL("/api/pets", httpBaseUrl), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Pet list failed with ${response.status}`);
    }
    const data = await response.json();
    renderPet(root, httpBaseUrl, Array.isArray(data.pets) ? data.pets : []);
  } catch {
    renderEmpty(root, "Could not load local Codex pets.");
  }
}

void main();
