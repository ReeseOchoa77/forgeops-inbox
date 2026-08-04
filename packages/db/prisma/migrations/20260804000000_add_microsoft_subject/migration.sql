-- AlterTable
ALTER TABLE "User" ADD COLUMN "microsoftSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_microsoftSubject_key" ON "User"("microsoftSubject");
