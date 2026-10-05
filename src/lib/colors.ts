export const SESSION_COLORS = [
	"#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
	"#06b6d4", "#f97316", "#ec4899", "#10b981", "#6366f1",
];

export function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}
