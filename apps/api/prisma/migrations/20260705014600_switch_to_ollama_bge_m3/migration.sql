-- AlterColumn: Change embedding vector dimension from 2048 (DeepSeek) to 1024 (Ollama bge-m3)
ALTER TABLE "intent_examples" ALTER COLUMN "embedding" TYPE vector(1024);
