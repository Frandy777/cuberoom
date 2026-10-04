// The sliding highlight behind the selected option of a segmented control. Place it first
// in a `position: relative` row of equal-width buttons; `pad` and `gap` match the row's.
export function Thumb({
  index,
  count,
  pad,
  gap,
}: {
  index: number;
  count: number;
  pad: number;
  gap: number;
}) {
  return (
    <span
      className="thumb"
      aria-hidden
      style={{
        inset: `${pad}px auto ${pad}px ${pad}px`,
        width: `calc((100% - ${pad * 2 + gap * (count - 1)}px) / ${count})`,
        transform: `translateX(calc(${index} * (100% + ${gap}px)))`,
      }}
    />
  );
}
