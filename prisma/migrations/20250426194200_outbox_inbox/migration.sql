/*
  Warnings:

  - Added the required column `consumer` to the `processed_events` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "processed_events" ADD COLUMN     "consumer" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "msg_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "traceparent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");
