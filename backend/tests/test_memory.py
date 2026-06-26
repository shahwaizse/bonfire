import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from app import db, memory


class MemoryStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp(prefix="bonfire-memory-test-"))
        self.original_db_path = db.DATABASE_PATH
        self.original_chroma_path = memory.MEMORY_CHROMA_PATH
        db.DATABASE_PATH = str(self.temp_dir / "app.db")
        memory.MEMORY_CHROMA_PATH = str(self.temp_dir / "chroma")
        memory._client = None
        memory._collection = None
        memory._chroma_available = False
        await db.init_db()
        await memory.init_memory()

    async def asyncTearDown(self) -> None:
        memory._client = None
        memory._collection = None
        memory._chroma_available = False
        db.DATABASE_PATH = self.original_db_path
        memory.MEMORY_CHROMA_PATH = self.original_chroma_path
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    async def test_explicit_memory_persists_across_chroma_reinit(self) -> None:
        conversation_id = await db.create_conversation("Memory test")
        message_id = await db.add_message(
            conversation_id,
            "user",
            "Remember that I prefer VS Code for TypeScript projects.",
        )

        result = await memory.process_user_memory_directives(
            conversation_id,
            message_id,
            "Remember that I prefer VS Code for TypeScript projects.",
        )

        self.assertEqual(len(result["created"]), 1)
        found = await memory.retrieve_memories("Which editor do I like for frontend work?", limit=3)
        self.assertTrue(any("VS Code" in item["text"] for item in found))

        memory._client = None
        memory._collection = None
        memory._chroma_available = False
        await memory.init_memory()

        found_after_reinit = await memory.retrieve_memories("TypeScript editor preference", limit=3)
        self.assertTrue(any("VS Code" in item["text"] for item in found_after_reinit))

    async def test_remember_text_dedupes_exact_memories(self) -> None:
        first = await memory.remember_text(
            "The user prefers direct engineering answers.",
            kind="preference",
            topics=["engineering"],
            confidence=0.72,
        )
        second = await memory.remember_text(
            "The user prefers direct engineering answers.",
            kind="preference",
            topics=["answers"],
            confidence=0.88,
        )

        self.assertEqual(first["id"], second["id"])
        listed = await memory.list_memories()
        self.assertEqual(len(listed), 1)
        self.assertGreaterEqual(listed[0]["confidence"], 0.88)
        self.assertIn("engineering", listed[0]["topics"])
        self.assertIn("answers", listed[0]["topics"])

    async def test_forget_directive_archives_matching_memory(self) -> None:
        created = await memory.remember_text(
            "The user prefers VS Code for TypeScript projects.",
            kind="preference",
            topics=["typescript"],
        )
        conversation_id = await db.create_conversation("Forget test")
        message_id = await db.add_message(conversation_id, "user", "Forget my VS Code preference.")

        result = await memory.process_user_memory_directives(
            conversation_id,
            message_id,
            "Forget my VS Code preference.",
        )

        self.assertTrue(any(item["id"] == created["id"] for item in result["archived"]))
        archived = await memory.get_memory(created["id"])
        self.assertIsNotNone(archived)
        self.assertTrue(archived["archived"])
        found = await memory.retrieve_memories("editor preference", limit=3)
        self.assertFalse(any(item["id"] == created["id"] for item in found))

    async def test_graph_contains_memory_topic_and_entity_nodes(self) -> None:
        await memory.remember_text(
            "The user is building Bonfire with ChromaDB memory.",
            kind="semantic",
            topics=["bonfire", "memory"],
            entities=["Bonfire", "ChromaDB"],
        )

        graph = await memory.memory_graph()
        node_ids = {node["id"] for node in graph["nodes"]}
        self.assertIn("user", node_ids)
        self.assertIn("topic:bonfire", node_ids)
        self.assertIn("entity:chromadb", node_ids)
        self.assertGreater(len(graph["edges"]), 0)

    async def test_clear_memories_removes_chroma_vectors_after_reinit(self) -> None:
        await memory.remember_text(
            "The user has a temporary clear-test memory.",
            kind="semantic",
            topics=["clear-test"],
        )
        self.assertEqual((await memory.memory_status())["chroma_count"], 1)

        memory._client = None
        memory._collection = None
        memory._chroma_available = False
        await memory.clear_memories()

        status = await memory.memory_status()
        self.assertEqual(status["active"], 0)
        self.assertEqual(status["chroma_count"], 0)

    async def test_parallel_explicit_memory_writes(self) -> None:
        conversation_id = await db.create_conversation("Parallel memory")

        async def remember(index: int) -> None:
            text = f"Remember that project codename Alpha-{index} belongs to test lane {index}."
            message_id = await db.add_message(conversation_id, "user", text)
            await memory.process_user_memory_directives(conversation_id, message_id, text)

        await asyncio.gather(*(remember(index) for index in range(8)))

        listed = await memory.list_memories()
        self.assertEqual(len(listed), 8)
        self.assertTrue(all("Alpha-" in item["text"] for item in listed))


if __name__ == "__main__":
    unittest.main()
