-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL DEFAULT 'EVENT',
    "source" TEXT NOT NULL DEFAULT 'FORGEOPS',
    "externalEventId" TEXT,
    "linkedJobId" TEXT,
    "linkedTaskId" TEXT,
    "linkedEmailMessageId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_workspaceId_startAt_idx" ON "CalendarEvent"("workspaceId", "startAt");
CREATE INDEX "CalendarEvent_workspaceId_type_idx" ON "CalendarEvent"("workspaceId", "type");
CREATE INDEX "CalendarEvent_linkedJobId_idx" ON "CalendarEvent"("linkedJobId");
CREATE INDEX "CalendarEvent_linkedTaskId_idx" ON "CalendarEvent"("linkedTaskId");
CREATE INDEX "CalendarEvent_workspaceId_source_externalEventId_idx" ON "CalendarEvent"("workspaceId", "source", "externalEventId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_linkedJobId_fkey" FOREIGN KEY ("linkedJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_linkedTaskId_fkey" FOREIGN KEY ("linkedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
