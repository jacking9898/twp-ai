"""Convert the complete upstream CSV into bounded, local-only lookup shards.

Usage: python scripts/build-offline-dictionary.py path/to/stardict.csv
The original CSV is private build input; all fields and rows are retained in
the distributable shards. No frequency cutoff or common-word subset is used.
"""
import csv
import hashlib
import json
import pathlib
import sys
import tempfile
from contextlib import ExitStack

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "src/data/dictionary"
REVISION = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"


def bucket(word):
    value = 2166136261
    units = word.encode("utf-16-le")
    for i in range(0, len(units), 2):
        value = ((value ^ (units[i] | units[i + 1] << 8)) * 16777619) & 0xffffffff
    return f"{value & 255:02x}"


def build(source):
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_hash != "88fce01e0a30524192a62e363d47eeb036fa17820d5826121b3b419fd67a3996":
        raise ValueError("Input is not the pinned complete ECDICT CSV")
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "LICENSE.txt").write_bytes((ROOT / "licenses/ECDICT-MIT.txt").read_bytes())
    csv.field_size_limit(10_000_000)
    stats = dict(rows=0, chinese=0, phonetics=0, phrases=0, keys=0)
    with tempfile.TemporaryDirectory(dir=source.parent, prefix="dictionary-shards-") as temporary, ExitStack() as stack:
        files = [stack.enter_context(open(pathlib.Path(temporary) / f"{i:02x}", "w", encoding="utf-8")) for i in range(256)]
        with source.open(encoding="utf-8-sig", newline="") as file:
            reader = csv.reader(file)
            columns = next(reader)
            assert columns == "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio".split(",")
            for row in reader:
                if len(row) != len(columns):
                    raise ValueError(f"Invalid CSV row {reader.line_num}")
                key = row[0].strip().replace("’", "'").replace("‘", "'").lower()
                if not key:
                    raise ValueError(f"Empty headword at {reader.line_num}")
                files[int(bucket(key), 16)].write(json.dumps([key, row], ensure_ascii=False, separators=(",", ":")) + "\n")
                stats["rows"] += 1
                stats["chinese"] += bool(row[3])
                stats["phonetics"] += bool(row[1])
                stats["phrases"] += " " in row[0]
                if stats["rows"] % 500_000 == 0:
                    print(f"Read {stats['rows']:,} entries", flush=True)
        for file in files:
            file.flush()
        shards = {}
        for i in range(256):
            name = f"{i:02x}.json"
            data = {}
            with open(pathlib.Path(temporary) / f"{i:02x}", encoding="utf-8") as file:
                for line in file:
                    key, row = json.loads(line)
                    data.setdefault(key, []).append(row)
            raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
            (DEST / name).write_bytes(raw)
            stats["keys"] += len(data)
            shards[name] = dict(keys=len(data), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    metadata = dict(provider="ECDICT complete", revision=REVISION,
                    source=f"https://github.com/skywind3000/ECDICT/blob/{REVISION}/stardict.7z",
                    archiveSHA256="f370a0ecb58ada758d9dfe739db1667fd4ed87ed3055a4a7cb6c7054ecdf83d6",
                    csvSHA256=source_hash,
                    license="MIT", columns=columns, stats=stats, shards=shards)
    (DEST / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats), flush=True)


if __name__ == "__main__":
    build(pathlib.Path(sys.argv[1]).resolve())
