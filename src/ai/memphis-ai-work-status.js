import { summarizeScheduleAreas } from "../schedule-display.js";

export function weekdayNameForIsoDate(serviceDate = "") {
  const date = new Date(`${serviceDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "that day";
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()] || "that day";
}

function compactScheduleSummary(assignments = []) {
  const sections = summarizeScheduleAreas(assignments);
  const itemCount = sections.reduce((total, section) => total + section.items.length, 0);
  const includeTimes = itemCount <= 8;
  const text = sections.map((section) => {
    const areas = section.items.map((item) => {
      if (!includeTimes || !item.time_label) return item.name;
      return `${item.name} (${item.time_label})`;
    });
    return `${section.title}: ${areas.join(", ")}`;
  }).join(". ");
  return text.length > 1700 ? `${text.slice(0, 1697).trimEnd()}...` : text;
}

export function summarizeEmployeeWorkStatus(status = {}) {
  if (!status?.ok) return "I could not resolve that employee's work status.";

  const name = status.employee_name || "That employee";
  const serviceDate = status.service_date || "that date";
  const weekday = status.weekday || weekdayNameForIsoDate(serviceDate);
  const workStatus = String(status.work_status || "").trim();
  const shift = status.shift && typeof status.shift === "object" ? status.shift : {};
  const assignments = Array.isArray(status.assignments) ? status.assignments : [];
  const shiftStart = String(shift.shift_start || "").slice(0, 5);
  const shiftEnd = String(shift.shift_end || "").slice(0, 5);
  const lunch = shift.lunch ? `, lunch ${shift.lunch}` : "";

  if (workStatus === "off_static") {
    return `${name} is off on ${weekday}, ${serviceDate}.`;
  }

  if (["off_pto", "off_sick", "off_callout", "off_absence_override", "off_shift_override"].includes(workStatus)) {
    const label = workStatus === "off_pto" ? "out on PTO"
      : workStatus === "off_sick" ? "out sick"
      : workStatus === "off_callout" ? "called out"
      : "off";
    return `${name} is ${label} on ${weekday}, ${serviceDate}.`;
  }

  if (workStatus === "working_unassigned") {
    return `${name} is scheduled to work on ${weekday}, ${serviceDate}${shiftStart && shiftEnd ? ` from ${shiftStart} to ${shiftEnd}${lunch}` : ""}, but no area assignments are generated yet.`;
  }

  if (workStatus === "working_assigned") {
    if (!assignments.length) {
      return `${name} is scheduled to work on ${weekday}, ${serviceDate}${shiftStart && shiftEnd ? ` from ${shiftStart} to ${shiftEnd}${lunch}` : ""}, and has generated assignments.`;
    }
    const scheduleSummary = compactScheduleSummary(assignments);
    return `${name} is working on ${weekday}, ${serviceDate}${shiftStart && shiftEnd ? ` from ${shiftStart} to ${shiftEnd}${lunch}` : ""}. ${scheduleSummary}.`;
  }

  if (workStatus === "inactive_employee") {
    return `${name} is not active in the employee roster.`;
  }

  return `${name}'s work status for ${weekday}, ${serviceDate} is ${workStatus || "unknown"}.`;
}
