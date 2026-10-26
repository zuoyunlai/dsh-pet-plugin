"""edge-tts 常驻 worker：一行一个 JSON 请求，一行一个 JSON 结果。

比「每句起一个 python」省掉 ~2s 的解释器启动 + TLS 握手。
请求：{"id":1,"text":"...","voice":"zh-CN-XiaoxiaoNeural","pitch":"+0Hz","rate":"+0%","out":"C:\\...\\x.mp3"}
结果：{"id":1,"ok":true} 或 {"id":1,"ok":false,"err":"..."}

依赖目录：环境变量 DSH_PET_PY_DIR 优先，否则用同目录下的 py/。
"""
import asyncio
import json
import os
import sys

# Windows 下 python 的 stdio 默认跟随系统编码（cp936 等），
# 而我们和宿主约定的是 UTF-8 JSON。这里强制两边都用 UTF-8。
try:
    sys.stdin.reconfigure(encoding='utf-8', errors='replace')
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.environ.get('DSH_PET_PY_DIR') or os.path.join(_here, 'py'))

import edge_tts  # noqa: E402


async def synth(req):
    comm = edge_tts.Communicate(
        req['text'],
        req['voice'],
        rate=req.get('rate') or '+0%',
        pitch=req.get('pitch') or '+0Hz',
        volume=req.get('volume') or '+0%',
    )
    with open(req['out'], 'wb') as f:
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get('id')
        try:
            asyncio.run(synth(req))
            sys.stdout.write(json.dumps({'id': rid, 'ok': True}) + '\n')
        except Exception as e:  # 单条失败不能拖垮 worker
            sys.stdout.write(json.dumps({'id': rid, 'ok': False, 'err': str(e)[:200]}) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
