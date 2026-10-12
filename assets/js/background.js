"use strict";
/**
 * Physarum background.
 *
 * The trail lives on a document-sized grid, so it scrolls with the page.
 * A viewport canvas draws only the visible slice. Text blocks are dead
 * zones: agents steer around them, and the padding breathes. The
 * simulation steps at a fixed rate.
 */
const RAMP = " .:-=+*#%@";
const CELL = 10;
const AGENT_COUNT = 400;
const MAX_AGENTS = 1400;
const SENSOR_DIST = 3;
const SENSOR_ANGLE = 0.5;
const TURN = 0.35;
const SPEED = 0.65;
const DEPOSIT = 1;
const DECAY = 0.92;
const DIFFUSE = 0.2;
const FOOD = 4;
const TRAIL_CAP = 6;
const GLYPH_ALPHA = 0.72;
const MIN_VISIBLE = 0.08;
const STEP_MS = 1000 / 60;
const MAX_STEPS = 4;
const ZONE_PAD = 14;
const ZONE_BREATHE = 5;
const ZONE_FEATHER = 18;
const BREATHE_MS = 5600;
const ZONE_SELECTOR = "h1, h2, h3, p, .gantt-name, .gantt-years span, .hero-links a, .footer a, .snake-embed";
const FONT = `${CELL}px "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace`;
class PhysarumField {
    constructor(cols, rows, agentCount, previous) {
        this.zones = [];
        this.cols = cols;
        this.rows = rows;
        this.agentCount = agentCount;
        this.trail = new Float32Array(cols * rows);
        this.next = new Float32Array(cols * rows);
        this.ax = new Float32Array(agentCount);
        this.ay = new Float32Array(agentCount);
        this.aa = new Float32Array(agentCount);
        if (!previous) {
            for (let i = 0; i < agentCount; i++)
                this.spawn(i);
            return;
        }
        const copyCols = Math.min(cols, previous.cols);
        const copyRows = Math.min(rows, previous.rows);
        for (let y = 0; y < copyRows; y++) {
            const from = y * previous.cols;
            this.trail.set(previous.trail.subarray(from, from + copyCols), y * cols);
        }
        const copyAgents = Math.min(agentCount, previous.agentCount);
        this.ax.set(previous.ax.subarray(0, copyAgents));
        this.ay.set(previous.ay.subarray(0, copyAgents));
        this.aa.set(previous.aa.subarray(0, copyAgents));
        for (let i = 0; i < copyAgents; i++) {
            this.ax[i] = wrap(this.ax[i], cols);
            this.ay[i] = wrap(this.ay[i], rows);
        }
        for (let i = copyAgents; i < agentCount; i++)
            this.spawn(i);
    }
    setZones(zones) {
        this.zones = zones;
    }
    step() {
        this.moveAgents();
        this.diffuseDecay();
        this.clearZones();
    }
    feed(cellX, cellY) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (dx * dx + dy * dy > 5)
                    continue;
                this.add(cellX + dx, cellY + dy, FOOD);
            }
        }
    }
    burst(cellX, cellY) {
        for (let dy = -6; dy <= 6; dy++) {
            for (let dx = -6; dx <= 6; dx++) {
                const x = cellX + dx;
                const y = cellY + dy;
                if (this.blocked(x, y))
                    continue;
                const index = this.index(x, y);
                this.trail[index] = TRAIL_CAP;
            }
        }
    }
    rowSlice(y, x0, x1) {
        let line = "";
        const offset = y * this.cols;
        for (let x = x0; x < x1; x++)
            line += glyphFor(this.trail[offset + x]);
        return line;
    }
    spawn(index) {
        this.ax[index] = Math.random() * this.cols;
        this.ay[index] = Math.random() * this.rows;
        this.aa[index] = Math.random() * Math.PI * 2;
    }
    moveAgents() {
        for (let i = 0; i < this.agentCount; i++) {
            const escape = this.escapeAngle(this.ax[i], this.ay[i]);
            if (escape !== null) {
                this.aa[i] += wrapAngle(escape - this.aa[i]) * 0.55;
            }
            else {
                const angle = this.aa[i];
                const ahead = this.sense(this.ax[i], this.ay[i], angle);
                const left = this.sense(this.ax[i], this.ay[i], angle - SENSOR_ANGLE);
                const right = this.sense(this.ax[i], this.ay[i], angle + SENSOR_ANGLE);
                if (left > ahead && left > right)
                    this.aa[i] -= TURN;
                else if (right > ahead && right > left)
                    this.aa[i] += TURN;
                else
                    this.aa[i] += (Math.random() - 0.5) * 0.05;
            }
            this.ax[i] += Math.cos(this.aa[i]) * SPEED;
            this.ay[i] += Math.sin(this.aa[i]) * SPEED;
            this.ax[i] = wrap(this.ax[i], this.cols);
            this.ay[i] = wrap(this.ay[i], this.rows);
            this.add(this.ax[i], this.ay[i], DEPOSIT);
        }
    }
    diffuseDecay() {
        for (let y = 0; y < this.rows; y++) {
            const yUp = (y - 1 + this.rows) % this.rows;
            const yDown = (y + 1) % this.rows;
            for (let x = 0; x < this.cols; x++) {
                const xLeft = (x - 1 + this.cols) % this.cols;
                const xRight = (x + 1) % this.cols;
                const here = this.trail[y * this.cols + x];
                const average = (here +
                    this.trail[y * this.cols + xLeft] +
                    this.trail[y * this.cols + xRight] +
                    this.trail[yUp * this.cols + x] +
                    this.trail[yDown * this.cols + x] +
                    this.trail[yUp * this.cols + xLeft] +
                    this.trail[yUp * this.cols + xRight] +
                    this.trail[yDown * this.cols + xLeft] +
                    this.trail[yDown * this.cols + xRight]) /
                    9;
                this.next[y * this.cols + x] = (here * (1 - DIFFUSE) + average * DIFFUSE) * DECAY;
            }
        }
        const previous = this.trail;
        this.trail = this.next;
        this.next = previous;
    }
    clearZones() {
        for (const zone of this.zones) {
            const x0 = clamp(Math.floor(zone.left / CELL), 0, this.cols);
            const x1 = clamp(Math.ceil(zone.right / CELL), 0, this.cols);
            const y0 = clamp(Math.floor(zone.top / CELL), 0, this.rows);
            const y1 = clamp(Math.ceil(zone.bottom / CELL), 0, this.rows);
            for (let y = y0; y < y1; y++) {
                const offset = y * this.cols;
                this.trail.fill(0, offset + x0, offset + x1);
            }
        }
    }
    sense(x, y, angle) {
        const sampleX = x + Math.cos(angle) * SENSOR_DIST;
        const sampleY = y + Math.sin(angle) * SENSOR_DIST;
        if (this.blocked(sampleX, sampleY))
            return 0;
        return this.trail[this.index(sampleX, sampleY)];
    }
    add(x, y, amount) {
        if (this.blocked(x, y))
            return;
        const index = this.index(x, y);
        this.trail[index] = Math.min(TRAIL_CAP, this.trail[index] + amount);
    }
    blocked(x, y) {
        const px = x * CELL;
        const py = y * CELL;
        for (const zone of this.zones) {
            if (px >= zone.left && px < zone.right && py >= zone.top && py < zone.bottom)
                return true;
        }
        return false;
    }
    escapeAngle(x, y) {
        const px = x * CELL;
        const py = y * CELL;
        let nearest = Infinity;
        let angle = null;
        for (const zone of this.zones) {
            if (px < zone.left || px >= zone.right || py < zone.top || py >= zone.bottom)
                continue;
            const toLeft = px - zone.left;
            const toRight = zone.right - px;
            const toTop = py - zone.top;
            const toBottom = zone.bottom - py;
            const distance = Math.min(toLeft, toRight, toTop, toBottom);
            if (distance >= nearest)
                continue;
            nearest = distance;
            if (distance === toLeft)
                angle = Math.PI;
            else if (distance === toRight)
                angle = 0;
            else if (distance === toTop)
                angle = -Math.PI / 2;
            else
                angle = Math.PI / 2;
        }
        return angle;
    }
    index(x, y) {
        const column = wrapIndex(Math.floor(x), this.cols);
        const row = wrapIndex(Math.floor(y), this.rows);
        return row * this.cols + column;
    }
}
function glyphFor(value) {
    if (value < MIN_VISIBLE)
        return " ";
    const t = Math.min(1, value / TRAIL_CAP);
    const index = Math.min(RAMP.length - 1, Math.floor(t * (RAMP.length - 1)));
    return RAMP.charAt(index);
}
function wrap(value, size) {
    if (size <= 0)
        return 0;
    return ((value % size) + size) % size;
}
function wrapIndex(value, size) {
    return ((value % size) + size) % size;
}
function wrapAngle(delta) {
    const turn = Math.PI * 2;
    return ((delta + Math.PI) % turn + turn) % turn - Math.PI;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function accentColor() {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return value || "#8fa88a";
}
function agentPopulation(rows) {
    const viewportRows = Math.max(1, Math.ceil(window.innerHeight / CELL));
    const scaled = Math.round((AGENT_COUNT * rows) / viewportRows);
    return clamp(scaled, AGENT_COUNT, MAX_AGENTS);
}
function zonePad(now) {
    const wave = Math.sin((now / BREATHE_MS) * Math.PI * 2);
    return ZONE_PAD + wave * ZONE_BREATHE;
}
function measureZones() {
    const zones = [];
    for (const node of document.querySelectorAll(ZONE_SELECTOR)) {
        const box = node.getBoundingClientRect();
        if (box.width < 2 || box.height < 2)
            continue;
        zones.push({
            left: box.left + window.scrollX,
            top: box.top + window.scrollY,
            right: box.right + window.scrollX,
            bottom: box.bottom + window.scrollY,
        });
    }
    return zones;
}
function expandZones(zones, pad) {
    return zones.map((zone) => ({
        left: zone.left - pad,
        top: zone.top - pad,
        right: zone.right + pad,
        bottom: zone.bottom + pad,
    }));
}
function fadeAt(px, py, zones, feather) {
    let fade = 1;
    for (const zone of zones) {
        const dx = px < zone.left ? zone.left - px : px > zone.right ? px - zone.right : 0;
        const dy = py < zone.top ? zone.top - py : py > zone.bottom ? py - zone.bottom : 0;
        if (dx === 0 && dy === 0)
            return 0;
        const distance = dx === 0 ? dy : dy === 0 ? dx : Math.hypot(dx, dy);
        if (distance < feather)
            fade = Math.min(fade, distance / feather);
    }
    return fade;
}
function alphaBucket(fade) {
    if (fade <= 0.05)
        return 0;
    if (fade < 0.75)
        return 0.4;
    return 1;
}
function mount(canvas) {
    const context = canvas.getContext("2d");
    if (!context)
        return;
    const ctx = context;
    let field = null;
    let zones = [];
    let scaleX = 1;
    let pointerX = -1;
    let pointerY = -1;
    let feeding = false;
    let frameId = 0;
    let ink = accentColor();
    let lastTime = performance.now();
    let accumulator = 0;
    let layoutQueued = false;
    const measureFont = (dpr) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = FONT;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const measured = ctx.measureText("0").width;
        scaleX = measured > 0 ? CELL / measured : 1;
    };
    const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const docH = Math.max(document.documentElement.scrollHeight, viewportH);
        const bitmapW = Math.floor(viewportW * dpr);
        const bitmapH = Math.floor(viewportH * dpr);
        if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
            canvas.width = bitmapW;
            canvas.height = bitmapH;
        }
        measureFont(dpr);
        const cols = Math.max(1, Math.ceil(viewportW / CELL));
        const rows = Math.max(1, Math.ceil(docH / CELL));
        if (!field || field.cols !== cols || field.rows !== rows) {
            field = new PhysarumField(cols, rows, agentPopulation(rows), field);
        }
        zones = measureZones();
        ink = accentColor();
    };
    const scheduleLayout = () => {
        if (layoutQueued)
            return;
        layoutQueued = true;
        window.requestAnimationFrame(() => {
            layoutQueued = false;
            resize();
        });
    };
    const paint = (cores) => {
        if (!field)
            return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.font = FONT;
        ctx.fillStyle = ink;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.setTransform(dpr * scaleX, 0, 0, dpr, 0, 0);
        const y0 = Math.max(0, Math.floor(scrollY / CELL) - 1);
        const y1 = Math.min(field.rows, Math.ceil((scrollY + window.innerHeight) / CELL) + 1);
        for (let y = y0; y < y1; y++) {
            const py = (y + 0.5) * CELL;
            const userY = y * CELL - scrollY;
            let x = 0;
            while (x < field.cols) {
                const fade = alphaBucket(fadeAt((x + 0.5) * CELL, py, cores, ZONE_FEATHER));
                let end = x + 1;
                while (end < field.cols && alphaBucket(fadeAt((end + 0.5) * CELL, py, cores, ZONE_FEATHER)) === fade) {
                    end += 1;
                }
                if (fade > 0) {
                    const line = field.rowSlice(y, x, end);
                    if (line.trim() !== "") {
                        ctx.globalAlpha = GLYPH_ALPHA * fade;
                        ctx.fillText(line, (x * CELL - scrollX) / scaleX, userY);
                    }
                }
                x = end;
            }
        }
        ctx.globalAlpha = 1;
    };
    const frame = (now) => {
        if (document.hidden)
            return;
        const delta = Math.min(50, now - lastTime);
        lastTime = now;
        accumulator += delta;
        const pad = zonePad(now);
        const cores = expandZones(zones, pad);
        field?.setZones(cores);
        let steps = 0;
        while (accumulator >= STEP_MS && steps < MAX_STEPS) {
            if (feeding && pointerX >= 0 && field) {
                field.feed(Math.floor((pointerX + window.scrollX) / CELL), Math.floor((pointerY + window.scrollY) / CELL));
            }
            field?.step();
            accumulator -= STEP_MS;
            steps += 1;
        }
        paint(cores);
        frameId = window.requestAnimationFrame(frame);
    };
    const onPointerMove = (event) => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        feeding = true;
    };
    const onPointerDown = (event) => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        field?.burst(Math.floor((event.clientX + window.scrollX) / CELL), Math.floor((event.clientY + window.scrollY) / CELL));
    };
    const onPointerLeave = () => {
        feeding = false;
    };
    const onVisibility = () => {
        window.cancelAnimationFrame(frameId);
        if (!document.hidden) {
            lastTime = performance.now();
            accumulator = 0;
            frameId = window.requestAnimationFrame(frame);
        }
    };
    resize();
    window.addEventListener("resize", scheduleLayout);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    if (document.fonts)
        void document.fonts.ready.then(scheduleLayout);
    for (const image of document.images) {
        if (!image.complete)
            image.addEventListener("load", scheduleLayout, { once: true });
    }
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(document.documentElement);
    frameId = window.requestAnimationFrame(frame);
}
function boot() {
    const canvas = document.querySelector("#bg-sim");
    if (!canvas)
        return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        return;
    mount(canvas);
}
boot();
