import type { Prisma } from "@prisma/client";

export function canEditJob(workspaceRole: string): boolean {
  return workspaceRole === "OWNER" || workspaceRole === "EDITOR";
}

export function fabricationItemWhere(
  workspaceId: string,
  jobId: string,
  itemId?: string,
): Prisma.JobFabricationItemWhereInput {
  return itemId ? { id: itemId, workspaceId, jobId } : { workspaceId, jobId };
}

export function lineEstimatedHours(quantity: number, hoursPerPiece: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(hoursPerPiece)) return 0;
  return Math.round(quantity * hoursPerPiece * 100) / 100;
}

export function totalEstimatedHours(
  items: Array<{ quantity: number; estimatedHoursPerPiece: number }>,
): number {
  const sum = items.reduce(
    (acc, item) => acc + lineEstimatedHours(item.quantity, item.estimatedHoursPerPiece),
    0,
  );
  return Math.round(sum * 100) / 100;
}

export function decimalToNumber(value: { toString(): string } | number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

export function presentFabricationItem(item: {
  id: string;
  name: string;
  quantity: { toString(): string } | number | string;
  estimatedHoursPerPiece: { toString(): string } | number | string;
  sortOrder: number;
}) {
  const quantity = decimalToNumber(item.quantity);
  const estimatedHoursPerPiece = decimalToNumber(item.estimatedHoursPerPiece);
  return {
    id: item.id,
    name: item.name,
    quantity,
    estimatedHoursPerPiece,
    totalHours: lineEstimatedHours(quantity, estimatedHoursPerPiece),
    sortOrder: item.sortOrder,
  };
}
