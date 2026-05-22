#!/usr/bin/env python3
"""
Job Copilot — Resume Extraction Test
Reads a PDF resume, sends to configured LLM, verifies extracted profile fields.

Usage:
    python3 test_extract.py [--pdf path/to/resume.pdf]
"""

import subprocess, json, urllib.request, sys, os, re

# Default config — reads from env or falls back to Nyro
LLM_URL = os.environ.get("JC_LLM_URL", "http://localhost:19530/v1/chat/completions")
LLM_KEY = os.environ.get("JC_LLM_KEY", "dummy")
LLM_MODEL = os.environ.get("JC_LLM_MODEL", "deepseek-v4-flash-2")

# Default PDF
HOME = os.path.expanduser("~")
DEFAULT_PDF = os.path.join(HOME, "Documents/Resume/tailored/Honeywell_20260522/Resume_Shivam_Bhalla_Honeywell_20260522.pdf")

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using pdftotext."""
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    result = subprocess.run(["pdftotext", pdf_path, "-"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext: {result.stderr}")
    text = result.stdout.strip()
    if not text:
        raise RuntimeError("No text extracted from PDF (empty)")
    return text

def extract_profile(resume_text):
    """Send resume to LLM, return parsed profile dict."""
    prompt = ("You are parsing a resume. Extract these fields as a JSON object "
              "(keys: name, email, phone, linkedin, github, website, address, work_authorization). "
              "Return ONLY the JSON. No other text.")

    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Resume:\n\n{resume_text[:4000]}"}
        ],
        "temperature": 0.01,
        "max_tokens": 500,
    }).encode()

    req = urllib.request.Request(LLM_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LLM_KEY}",
    })

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    msg = data["choices"][0]["message"]
    
    # Handle both normal and reasoning models
    raw = (msg.get("content") or "").strip()
    if not raw:
        raw = (msg.get("reasoning_content") or "").strip()
    if not raw:
        raise RuntimeError("LLM returned empty response")

    # Extract JSON from possible markdown fence
    m = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
    if m:
        raw = m.group(1)
    
    # Find JSON object bounds
    start = raw.index("{")
    end = raw.rindex("}") + 1
    return json.loads(raw[start:end])

def run_test(pdf_path):
    print(f"🔧 LLM: {LLM_MODEL} @ {LLM_URL}")
    print(f"📄 PDF: {pdf_path}")
    print()

    # Step 1: Extract text
    print("[1/3] Reading PDF...", end=" ", flush=True)
    resume_text = extract_text_from_pdf(pdf_path)
    print(f"✓ {len(resume_text)} chars")

    # Step 2: LLM extraction
    print("[2/3] Calling LLM...", end=" ", flush=True)
    try:
        profile = extract_profile(resume_text)
        print("✓")
    except Exception as e:
        print(f"\n      ✗ {e}")
        return False

    # Step 3: Verify
    print("[3/3] Verifying fields:")
    checks = [
        ("name", "Shivam", "Name"),
        ("email", "shivam.bhalla07", "Email"),
        ("phone", "+33", "Phone"),
        ("linkedin", "linkedin.com/in/shivambhalla07", "LinkedIn"),
        ("github", "github.com/shivam2014", "GitHub"),
        ("address", "Gdansk", "Address"),
    ]

    passed = 0
    for key, expected, label in checks:
        val = profile.get(key, "")
        if expected.lower() in val.lower():
            print(f"  ✅ {label}: {val}")
            passed += 1
        else:
            print(f"  ❌ {label}: {val or '(empty)'} (expected: {expected})")

    # Optional fields
    website = profile.get("website", "")
    work_auth = profile.get("work_authorization", "")
    if website:
        print(f"  ℹ️  Website: {website}")
    if work_auth:
        print(f"  ℹ️  Work Auth: {work_auth}")

    print(f"\n{'✅ ALL PASSED' if passed == len(checks) else '❌ SOME FAILED'} ({passed}/{len(checks)})")
    return passed == len(checks)

if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith("--pdf=") else DEFAULT_PDF
    if pdf == DEFAULT_PDF and len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        pdf = sys.argv[1]
    elif pdf == DEFAULT_PDF and len(sys.argv) > 1:
        pdf = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PDF
    
    if not os.path.exists(pdf):
        print(f"❌ PDF not found: {pdf}")
        sys.exit(1)
    
    sys.exit(0 if run_test(pdf) else 1)
