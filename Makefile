.PHONY: build clean

build:
	./build.sh

clean:
	rm -rf dist src-tauri/target src-tauri/gen src-tauri/target-tmp
