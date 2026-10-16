import { onLocaleChange, setMessage, t } from '../../i18n/engine/index.js';

/** Reusable discrete-step capsule: clicks, dragging, arrows, and Home/End share a native range input. */
export function mountCapsuleSlider(root, { id, label, onChange = () => {} }) {
  root.classList.add('litesay-capsule-slider');
  const track = document.createElement('div');
  track.className = 'litesay-capsule-track';
  track.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'litesay-capsule-fill';
  const points = document.createElement('div');
  points.className = 'litesay-capsule-points';
  track.append(fill, points);
  const marker = document.createElement('span');
  marker.className = 'litesay-capsule-marker';
  marker.setAttribute('aria-hidden', 'true');
  const labels = document.createElement('div');
  labels.className = 'litesay-capsule-labels';
  labels.setAttribute('aria-hidden', 'true');
  const input = document.createElement('input');
  input.id = id;
  input.type = 'range';
  input.min = 0;
  input.step = 1;
  root.replaceChildren(track, marker, labels, input);
  let choices = [];
  let selected;
  function render() {
    const index = choices.findIndex((choice) => choice.value === selected);
    input.max = Math.max(1, choices.length - 1);
    input.value = Math.max(0, index);
    input.disabled = choices.length < 2;
    input.dataset.value = selected || '';
    input.setAttribute('aria-label', t(label));
    input.setAttribute('aria-valuetext', t(choices[index]?.label || ''));
    root.style.setProperty('--stops', Math.max(1, choices.length));
    root.style.setProperty('--index', Math.max(0, index));
    root.style.setProperty(
      '--progress',
      choices.length === 1 ? 0.5 : Math.max(0, index) / Math.max(1, choices.length - 1),
    );
    points.replaceChildren(
      ...choices.map((_choice, pointIndex) => {
        const dot = document.createElement('span');
        dot.style.setProperty(
          '--position',
          choices.length === 1 ? 0.5 : pointIndex / (choices.length - 1),
        );
        dot.classList.toggle('filled', pointIndex <= index);
        return dot;
      }),
    );
    labels.replaceChildren(
      ...choices.map((choice, labelIndex) => {
        const span = document.createElement('span');
        setMessage(span, choice.label);
        span.title = t(choice.label);
        span.style.setProperty(
          '--position',
          choices.length === 1 ? 0.5 : labelIndex / (choices.length - 1),
        );
        span.classList.toggle('selected', choice.value === selected);
        return span;
      }),
    );
  }
  function changed() {
    selected = choices[Number(input.value)].value;
    render();
    onChange(selected);
  }
  input.addEventListener('input', changed);
  const unsubscribe = onLocaleChange(render);
  return {
    setChoices(items, value) {
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.some((item) => typeof item.value !== 'string' || typeof item.label !== 'string') ||
        new Set(items.map((item) => item.value)).size !== items.length
      )
        throw new Error('Capsule slider options need unique values and labels.');
      choices = items.map((item) => ({ ...item }));
      selected = choices.some((choice) => choice.value === value) ? value : choices[0].value;
      render();
    },
    value: () => selected,
    destroy() {
      unsubscribe();
      input.removeEventListener('input', changed);
      root.replaceChildren();
      root.classList.remove('litesay-capsule-slider');
    },
  };
}
