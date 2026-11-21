import os
import shutil
import subprocess
import unittest


class TestEdgeHandlersParity(unittest.TestCase):
    def test_edge_api_handlers_pass_node_suite(self):
        node_bin = shutil.which("node")
        if not node_bin:
            self.skipTest("Node.js runtime not available")

        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
        proc = subprocess.run(
            [node_bin, "--test", "backend/tests/test_edge_handlers.mjs"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(
            proc.returncode,
            0,
            msg=f"Node Edge handler tests failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
