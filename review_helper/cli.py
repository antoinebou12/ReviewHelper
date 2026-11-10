import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Review Helper locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--stdio", action="store_true", help="Run the MCP server over stdio.")
    args = parser.parse_args()
    if args.stdio:
        from .mcp_server import mcp

        mcp.run(transport="stdio")
    else:
        uvicorn.run("review_helper.app:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
