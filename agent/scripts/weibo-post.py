#!/usr/bin/env python
"""weibo-post.py - 带图发微博 (复用 aione WeiboCreaterApis, 支持本地图片路径)"""
import sys
import os
import json
import argparse


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--content", default="")
    p.add_argument("--image", action="append", default=[])
    p.add_argument("--visible", default="0")
    p.add_argument("--topics", default="")
    p.add_argument("--json", action="store_true")
    p.add_argument("--stdin", action="store_true", help="read noteInfo from stdin JSON")
    args = p.parse_args()

    if args.stdin:
        noteInfo = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    else:
        topics = [t.strip() for t in args.topics.split(",") if t.strip()] if args.topics else []
        noteInfo = {
            "content": args.content,
            "type": int(args.visible),
            "topics": topics,
            "images": args.image,
            "media_type": "image",
        }

    image_paths = noteInfo.get("images", [])
    image_bytes = []
    for path in image_paths:
        if not os.path.exists(path):
            print(json.dumps({"code": -1, "message": "image not found: " + path}), file=sys.stderr)
            sys.exit(1)
        with open(path, "rb") as f:
            image_bytes.append(f.read())
    noteInfo["images"] = image_bytes

    from all_in_one.cli.auth import CookieStore, resolve_cookie

    cookie = resolve_cookie("weibo", profile="web", store=CookieStore())
    if cookie is None:
        cookie = resolve_cookie("weibo", profile="default", store=CookieStore())
    if cookie is None:
        print(json.dumps({"code": -1, "message": "no aione weibo cookie. run: node scripts/sync-cookies.js sync"}), file=sys.stderr)
        sys.exit(1)
    cookies_str = cookie.value

    upstream_root = os.path.join(
        os.path.expanduser("~"), "AppData", "Local", "aione", "upstreams", "WeiboApis"
    )
    if not os.path.isdir(upstream_root):
        try:
            from platformdirs import user_data_dir
            upstream_root = os.path.join(user_data_dir("aione", appauthor=False), "upstreams", "WeiboApis")
        except Exception:
            pass
    if not os.path.isdir(upstream_root):
        print(json.dumps({"code": -1, "message": "WeiboApis not found. run: aione setup"}), file=sys.stderr)
        sys.exit(1)

    saved_cwd = os.getcwd()
    os.chdir(upstream_root)
    sys.path.insert(0, upstream_root)
    try:
        from apis.weibo_creator_apis import WeiboCreaterApis

        api = WeiboCreaterApis()
        res = api.post_weibo(noteInfo, cookies_str)
    finally:
        os.chdir(saved_cwd)

    if isinstance(res, dict) and res.get("ok") == 1 and "data" in res:
        d = res["data"]
        uid = d.get("user", {}).get("idstr", "")
        mblogid = d.get("mblogid", "")
        mid = d.get("idstr", d.get("id", ""))
        url = "https://weibo.com/{}/{}".format(uid, mblogid) if uid and mblogid else ""
        out = {"code": 0, "url": url, "id": mid, "mblogid": mblogid}
    else:
        out = {"code": -1, "message": json.dumps(res, ensure_ascii=False) if res else "empty response"}

    if args.json or args.stdin:
        print(json.dumps(out, ensure_ascii=False))
    else:
        if out["code"] == 0:
            print("posted: " + out["url"])
        else:
            print("failed: " + out.get("message", ""), file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()