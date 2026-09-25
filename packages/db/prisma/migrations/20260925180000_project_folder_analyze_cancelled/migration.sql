-- Allow Worker Jobs to abort a project-folder analysis without deleting saved mail.
ALTER TYPE "ProjectFolderAnalyzeStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
