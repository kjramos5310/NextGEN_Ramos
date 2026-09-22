import os
import sys

# Sin red real: sin API key el advisor usa solo el motor heurístico (load_dotenv no sobreescribe variables existentes).
os.environ["GEMINI_API_KEY"] = ""
os.environ["BACKEND_API_URL"] = "http://backend.test"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
