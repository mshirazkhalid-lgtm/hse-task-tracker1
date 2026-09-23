function todayStr() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toDateStr(v) {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

function daysBetween(aStr, bStr) {
  const a = new Date(aStr + "T00:00:00Z");
  const b = new Date(bStr + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

/**
 * Mirrors the classification logic used throughout the project (same rules
 * as the original artifact version): completed > delayed_start/upcoming >
 * overdue/at_risk > in_progress.
 */
function computeStatus(task) {
  const pct = Number(task.completion_pct ?? task.completionPct) || 0;
  const actualEnd = toDateStr(task.actual_end ?? task.actualEnd);
  const plannedStart = toDateStr(task.planned_start ?? task.plannedStart);
  const actualStart = toDateStr(task.actual_start ?? task.actualStart);
  const dueDate = toDateStr(task.due_date ?? task.dueDate);

  if (pct >= 100 || actualEnd) return "completed";
  const today = todayStr();
  if (plannedStart && !actualStart) {
    return plannedStart > today ? "upcoming" : "delayed_start";
  }
  if (dueDate) {
    const left = daysBetween(today, dueDate);
    if (left < 0) return "overdue";
    if (left <= 3) return "at_risk";
  }
  return "in_progress";
}

module.exports = { computeStatus, todayStr, daysBetween, toDateStr };
