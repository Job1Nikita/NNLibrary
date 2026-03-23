-- Add highlight marker for актуальные файлы
ALTER TABLE "File" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;
