import { Page } from 'playwright';
import {
  ExtractedAnimations,
  GsapExtraction,
  GsapTimelineEntry,
  ScrollTriggerEntry,
  CssAnimationEntry,
  TransitionEntry,
  ScrollPattern,
} from '../types.js';

// ---------------------------------------------------------------------------
// Selector helper – injected into every page.evaluate that needs it
// ---------------------------------------------------------------------------
const GENERATE_SELECTOR_FN = `
function generateSelector(el) {
  if (!el || !(el instanceof Element)) return '';

  // 1. ID
  if (el.id) return '#' + CSS.escape(el.id);

  // 2. Meaningful classes (skip Tailwind-style utility prefixes)
  const utilityPrefixes = [
    'w-', 'h-', 'p-', 'px-', 'py-', 'pt-', 'pb-', 'pl-', 'pr-',
    'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-',
    'text-', 'bg-', 'border-', 'rounded-', 'flex-', 'grid-',
    'col-', 'row-', 'gap-', 'space-', 'min-', 'max-',
    'sm:', 'md:', 'lg:', 'xl:', '2xl:',
    'hover:', 'focus:', 'active:', 'group-',
    'transition-', 'duration-', 'ease-', 'delay-',
    'opacity-', 'scale-', 'translate-', 'rotate-',
    'z-', 'top-', 'left-', 'right-', 'bottom-',
    'absolute', 'relative', 'fixed', 'sticky',
    'block', 'inline', 'hidden', 'visible',
    'overflow-', 'object-', 'cursor-', 'pointer-events-',
  ];

  if (el.classList.length > 0) {
    var meaningful = [];
    for (var i = 0; i < el.classList.length; i++) {
      var cls = el.classList[i];
      var isUtility = false;
      for (var j = 0; j < utilityPrefixes.length; j++) {
        if (cls === utilityPrefixes[j] || cls.startsWith(utilityPrefixes[j])) {
          isUtility = true;
          break;
        }
      }
      if (!isUtility) meaningful.push(cls);
    }
    if (meaningful.length > 0) {
      var selector = '.' + meaningful.map(function(c) { return CSS.escape(c); }).join('.');
      // Verify uniqueness – if multiple elements match, add tag
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
        return el.tagName.toLowerCase() + selector;
      } catch (_) {
        return el.tagName.toLowerCase() + selector;
      }
    }
  }

  // 3. tagName:nth-child
  var parent = el.parentElement;
  if (!parent) return el.tagName.toLowerCase();

  var children = parent.children;
  var index = 0;
  for (var k = 0; k < children.length; k++) {
    if (children[k] === el) { index = k + 1; break; }
  }
  var parentSel = generateSelector(parent);
  return parentSel + ' > ' + el.tagName.toLowerCase() + ':nth-child(' + index + ')';
}
`;

// ---------------------------------------------------------------------------
// Layer 1: GSAP extraction
// ---------------------------------------------------------------------------
async function extractGsap(page: Page): Promise<GsapExtraction | null> {
  try {
    return await page.evaluate(`
      (function() {
        ${GENERATE_SELECTOR_FN}

        var gsap = window.gsap;
        if (!gsap || !gsap.globalTimeline) return null;

        function targetsToSelectors(targets) {
          if (!targets) return [];
          var result = [];
          for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            if (t instanceof Element) {
              var sel = generateSelector(t);
              if (sel) result.push(sel);
            } else if (typeof t === 'string') {
              result.push(t);
            }
          }
          return result;
        }

        function extractVarKeys(vars) {
          if (!vars) return [];
          var skip = [
            'ease', 'duration', 'delay', 'stagger', 'overwrite',
            'onComplete', 'onStart', 'onUpdate', 'onRepeat',
            'onCompleteParams', 'onStartParams', 'onUpdateParams',
            'lazy', 'immediateRender', 'id', 'paused',
            'repeat', 'yoyo', 'repeatDelay', 'scrollTrigger',
          ];
          var keys = [];
          for (var key in vars) {
            if (vars.hasOwnProperty(key) && skip.indexOf(key) === -1) {
              keys.push(key);
            }
          }
          return keys;
        }

        function extractVarValues(vars) {
          if (!vars) return {};
          var skip = [
            'ease', 'duration', 'delay', 'stagger', 'overwrite',
            'onComplete', 'onStart', 'onUpdate', 'onRepeat',
            'onCompleteParams', 'onStartParams', 'onUpdateParams',
            'lazy', 'immediateRender', 'id', 'paused',
            'repeat', 'yoyo', 'repeatDelay', 'scrollTrigger',
          ];
          var out = {};
          for (var key in vars) {
            if (vars.hasOwnProperty(key) && skip.indexOf(key) === -1) {
              try {
                var v = vars[key];
                if (typeof v === 'function') continue;
                out[key] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
              } catch (_) { /* skip non-serialisable */ }
            }
          }
          return out;
        }

        function walkTimeline(tl, depth) {
          if (depth > 10) return [];
          var entries = [];
          var children;
          try { children = tl.getChildren(false); } catch (_) { return entries; }

          for (var i = 0; i < children.length; i++) {
            var child = children[i];

            if (typeof child.getChildren === 'function') {
              // Nested timeline
              var nested = walkTimeline(child, depth + 1);
              entries.push({
                type: 'timeline',
                label: child.vars && child.vars.id ? String(child.vars.id) : undefined,
                startTime: typeof child.startTime === 'function' ? child.startTime() : undefined,
                children: nested,
              });
            } else {
              // Tween
              var targets;
              try { targets = child.targets(); } catch (_) { targets = []; }

              var vars = child.vars || {};
              entries.push({
                type: 'tween',
                targets: targetsToSelectors(targets),
                duration: typeof child.duration === 'function' ? child.duration() : undefined,
                delay: typeof child.delay === 'function' ? child.delay() : (vars.delay || 0),
                ease: vars.ease ? String(vars.ease) : undefined,
                properties: extractVarKeys(vars),
                toVars: extractVarValues(vars),
                startTime: typeof child.startTime === 'function' ? child.startTime() : undefined,
              });
            }
          }
          return entries;
        }

        var timeline = walkTimeline(gsap.globalTimeline, 0);

        // ScrollTrigger extraction
        var scrollTriggers = [];
        var ST = window.ScrollTrigger;
        if (ST && typeof ST.getAll === 'function') {
          var all = ST.getAll();
          for (var s = 0; s < all.length; s++) {
            var st = all[s];
            var triggerSel = '';
            if (st.trigger instanceof Element) {
              triggerSel = generateSelector(st.trigger);
            } else if (typeof st.trigger === 'string') {
              triggerSel = st.trigger;
            }

            var stVars = st.vars || {};
            var animData = null;
            if (st.animation) {
              var aTargets;
              try { aTargets = st.animation.targets(); } catch (_) { aTargets = []; }
              animData = {
                targets: targetsToSelectors(aTargets),
                duration: typeof st.animation.duration === 'function' ? st.animation.duration() : 0,
                vars: extractVarValues(st.animation.vars || {}),
              };
            }

            scrollTriggers.push({
              trigger: triggerSel,
              start: stVars.start ? String(stVars.start) : '',
              end: stVars.end ? String(stVars.end) : '',
              scrub: stVars.scrub != null ? stVars.scrub : false,
              pin: !!stVars.pin,
              animation: animData,
            });
          }
        }

        return { timeline: timeline, scrollTriggers: scrollTriggers };
      })()
    `);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer 2: CSS Animations (Web Animations API)
// ---------------------------------------------------------------------------
async function extractCssAnimations(page: Page): Promise<CssAnimationEntry[]> {
  try {
    return await page.evaluate(`
      (function() {
        ${GENERATE_SELECTOR_FN}

        if (typeof document.getAnimations !== 'function') return [];

        var anims = document.getAnimations();
        var results = [];

        for (var i = 0; i < anims.length; i++) {
          var anim = anims[i];
          var effect = anim.effect;
          if (!effect) continue;

          var target = effect.target;
          if (!target || !(target instanceof Element)) continue;

          var selector = generateSelector(target);
          if (!selector) continue;

          var keyframes = [];
          try {
            var kfs = effect.getKeyframes();
            for (var k = 0; k < kfs.length; k++) {
              var frame = {};
              var kf = kfs[k];
              for (var prop in kf) {
                if (kf.hasOwnProperty(prop)) {
                  try {
                    var val = kf[prop];
                    if (typeof val !== 'function') {
                      frame[prop] = val;
                    }
                  } catch (_) {}
                }
              }
              keyframes.push(frame);
            }
          } catch (_) {}

          var timing = { duration: 0, delay: 0, easing: 'linear', iterations: 1, fill: 'none' };
          try {
            var t = effect.getTiming();
            timing.duration = typeof t.duration === 'number' ? t.duration : 0;
            timing.delay = t.delay || 0;
            timing.easing = t.easing || 'linear';
            timing.iterations = t.iterations === Infinity ? 'infinite' : (t.iterations || 1);
            timing.fill = t.fill || 'none';
          } catch (_) {}

          var name = '';
          try {
            if (effect.getKeyframes && anim instanceof CSSAnimation) {
              name = anim.animationName || '';
            }
          } catch (_) {}
          if (!name && anim.id) name = anim.id;

          results.push({
            target: selector,
            name: name || 'unnamed',
            keyframes: keyframes,
            timing: timing,
          });
        }

        return results;
      })()
    `);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Layer 3: CSS Transitions
// ---------------------------------------------------------------------------
async function extractTransitions(page: Page): Promise<TransitionEntry[]> {
  try {
    return await page.evaluate(`
      (function() {
        ${GENERATE_SELECTOR_FN}

        var selectors = 'a, button, [class*="link"], [class*="btn"], [class*="nav"], img, [class*="card"], [class*="menu"], [class*="cta"], [class*="hover"]';
        var elements;
        try { elements = document.querySelectorAll(selectors); } catch (_) { return []; }

        var results = [];

        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var cs = window.getComputedStyle(el);

          var props = cs.transitionProperty;
          var durs = cs.transitionDuration;
          var fns = cs.transitionTimingFunction;
          var delays = cs.transitionDelay;

          if (!props || !durs) continue;

          // Filter out elements where all durations are 0s
          var durParts = durs.split(',').map(function(d) { return d.trim(); });
          var allZero = true;
          for (var d = 0; d < durParts.length; d++) {
            if (durParts[d] !== '0s' && durParts[d] !== '0ms') {
              allZero = false;
              break;
            }
          }
          if (allZero) continue;

          var selector = generateSelector(el);
          if (!selector) continue;

          results.push({
            selector: selector,
            properties: props.split(',').map(function(p) { return p.trim(); }),
            durations: durParts,
            easings: fns ? fns.split(',').map(function(e) { return e.trim(); }) : [],
            delays: delays ? delays.split(',').map(function(d) { return d.trim(); }) : [],
          });
        }

        return results;
      })()
    `);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Layer 4: Scroll pattern detection (runs in Node, analyses extracted data)
// ---------------------------------------------------------------------------
function detectScrollPatterns(gsap: GsapExtraction | null): ScrollPattern[] {
  const patterns: ScrollPattern[] = [];
  if (!gsap) return patterns;

  // --- Analyse ScrollTrigger entries ---
  for (const st of gsap.scrollTriggers) {
    const vars = st.animation?.vars ?? {};
    const targets = st.animation?.targets ?? [];
    const selector = st.trigger || targets[0] || '';
    if (!selector) continue;

    // Pin pattern
    if (st.pin) {
      patterns.push({
        type: 'pin',
        selector,
        description: `Pinned section at ${st.start} -> ${st.end}`,
        params: { start: st.start, end: st.end, scrub: st.scrub },
      });
      continue; // pin takes priority; don't double-classify
    }

    // Reveal pattern: opacity 0->1 or translateY movement
    const hasOpacity = vars.opacity !== undefined;
    const hasYMovement = vars.y !== undefined || vars.yPercent !== undefined || vars.translateY !== undefined;
    if (hasOpacity || hasYMovement) {
      const isScrub = st.scrub !== false && st.scrub !== 0;
      if (!isScrub) {
        patterns.push({
          type: 'reveal',
          selector,
          description: `Scroll-triggered reveal${hasOpacity ? ' (fade)' : ''}${hasYMovement ? ' (slide)' : ''}`,
          params: {
            start: st.start,
            end: st.end,
            ...(hasOpacity ? { opacity: vars.opacity } : {}),
            ...(vars.y !== undefined ? { y: vars.y } : {}),
          },
        });
        continue;
      }
    }

    // Parallax pattern: scrub + y/transform
    if (st.scrub !== false && st.scrub !== 0) {
      const hasTransform = vars.y !== undefined || vars.yPercent !== undefined
        || vars.x !== undefined || vars.xPercent !== undefined
        || vars.scale !== undefined || vars.rotation !== undefined;

      if (hasTransform) {
        patterns.push({
          type: 'parallax',
          selector,
          description: 'Scroll-scrubbed parallax movement',
          params: { scrub: st.scrub, vars },
        });
        continue;
      }

      // Progress pattern: scrub tied to arbitrary props
      patterns.push({
        type: 'progress',
        selector,
        description: 'Scroll-scrubbed progress animation',
        params: { scrub: st.scrub, properties: Object.keys(vars) },
      });
    }
  }

  // --- Stagger detection from timeline tweens ---
  detectStaggers(gsap.timeline, patterns);

  return patterns;
}

/**
 * Walk the GSAP timeline tree looking for groups of tweens on sibling targets
 * with incrementing delays -- the hallmark of a stagger animation.
 */
function detectStaggers(entries: GsapTimelineEntry[], patterns: ScrollPattern[]): void {
  // Collect top-level tweens with a defined startTime
  const tweens = entries.filter(
    (e) => e.type === 'tween' && e.startTime !== undefined && e.targets && e.targets.length > 0
  );

  if (tweens.length < 3) {
    // Recurse into nested timelines
    for (const e of entries) {
      if (e.type === 'timeline' && e.children && e.children.length > 0) {
        detectStaggers(e.children, patterns);
      }
    }
    return;
  }

  // Sort by startTime
  const sorted = [...tweens].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

  // Check for consistent delta between consecutive tweens
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    deltas.push((sorted[i].startTime ?? 0) - (sorted[i - 1].startTime ?? 0));
  }

  // If most deltas are equal (within 5 ms tolerance), it's a stagger
  if (deltas.length === 0) return;
  const commonDelta = deltas[0];
  const consistent = deltas.filter((d) => Math.abs(d - commonDelta) < 0.005).length;
  if (consistent >= deltas.length * 0.7 && commonDelta > 0) {
    const allTargets = sorted.flatMap((t) => t.targets ?? []);
    patterns.push({
      type: 'stagger',
      selector: allTargets[0] ?? '',
      description: `Stagger group of ${sorted.length} elements with ${(commonDelta * 1000).toFixed(0)}ms interval`,
      params: {
        count: sorted.length,
        staggerInterval: commonDelta,
        targets: allTargets.slice(0, 10), // cap to keep payload reasonable
      },
    });
  }

  // Still recurse into nested timelines
  for (const e of entries) {
    if (e.type === 'timeline' && e.children && e.children.length > 0) {
      detectStaggers(e.children, patterns);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function extractAnimations(page: Page): Promise<ExtractedAnimations> {
  // Run all browser layers concurrently; each is independently try/caught
  const [gsap, cssAnimations, transitions] = await Promise.all([
    extractGsap(page),
    extractCssAnimations(page),
    extractTransitions(page),
  ]);

  // Layer 4 runs in Node — pure data analysis
  const scrollPatterns = detectScrollPatterns(gsap);

  return {
    gsap,
    cssAnimations,
    transitions,
    scrollPatterns,
  };
}
