import unittest
from datetime import datetime

from app import searxng_client


class SearchClientTests(unittest.TestCase):
    def test_detects_visual_search_intent(self) -> None:
        self.assertTrue(searxng_client.wants_image_results("show me photos of the ThinkPad X1 Carbon"))
        self.assertTrue(searxng_client.wants_image_results("what does a blue-ringed octopus look like"))
        self.assertFalse(searxng_client.wants_image_results("when was the ThinkPad X1 Carbon released"))

    def test_query_variants_strip_chat_framing_and_keep_entities(self) -> None:
        variants = searxng_client._query_variants("Please look up the latest OpenAI web search API docs", 3)

        self.assertGreaterEqual(len(variants), 2)
        self.assertFalse(variants[0].lower().startswith("please"))
        self.assertTrue(any("openai" in variant.lower() for variant in variants))
        self.assertTrue(any(str(datetime.now().year) in variant for variant in variants))

    def test_image_result_normalization_preserves_visual_metadata(self) -> None:
        result = searxng_client._normalize_item(
            {
                "title": "Example image",
                "url": "https://example.com/gallery/page?utm_source=feed",
                "img_src": "https://cdn.example.com/image.jpg",
                "thumbnail": "/image_proxy?url=https%3A%2F%2Fcdn.example.com%2Fthumb.jpg",
                "resolution": "1280 x 720",
                "content": "A useful visual result.",
            },
            category="images",
            query="example image",
            rank=1,
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["kind"], "image")
        self.assertEqual(result["url"], "https://example.com/gallery/page")
        self.assertEqual(result["image_url"], "https://cdn.example.com/image.jpg")
        self.assertEqual(result["width"], 1280)
        self.assertEqual(result["height"], 720)
        self.assertTrue(result["thumbnail_url"].startswith("http://127.0.0.1:8888/image_proxy"))

    def test_rank_and_dedupe_prefers_stronger_canonical_result(self) -> None:
        weaker = searxng_client._normalize_item(
            {
                "title": "Bonfire project",
                "url": "https://example.com/bonfire?utm_campaign=noise",
                "content": "Short note.",
                "score": 0.1,
            },
            category="general",
            query="bonfire local ai assistant",
            rank=2,
        )
        stronger = searxng_client._normalize_item(
            {
                "title": "Bonfire local AI assistant",
                "url": "https://example.com/bonfire",
                "content": "Bonfire is a local AI assistant with web search.",
                "score": 5,
                "engines": ["brave", "duckduckgo"],
            },
            category="general",
            query="bonfire local ai assistant",
            rank=1,
        )

        ranked = searxng_client._rank_and_dedupe([weaker, stronger], "bonfire local ai assistant", limit=5)

        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0]["title"], "Bonfire local AI assistant")
        self.assertNotIn("_score", ranked[0])


if __name__ == "__main__":
    unittest.main()
