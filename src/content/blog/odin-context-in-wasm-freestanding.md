---
title: "Odin context in freestanding_wasm32"
description: >-
  Using Odin's context feature in WASM (non-WASI) with minimal overhead
pubDate: "2026-09-19"
heroImage: /blog/odin-context-in-wasm-freestanding/cover.webp
tags:
  - guide
  - odin
  - wasm
  - firefly-zero
---

[Odin](https://odin-lang.org/) has this [context](https://odin-lang.org/docs/overview/#explicit-context-definition)
feature, but using it with WASM (non-WASI) can add unwanted overhead.

I made some findings in how to avoid the overhead.

This guide is written with a focus on [Firefly Zero](https://fireflyzero.com/),
but also applies to other low-powered WASM environments such as [WASM-4](https://wasm4.org/)
or [Gamercade](https://gamercade.io/) (as fantasy consoles goes), or even when
writing WASM plugins.

For a "tl;dr", jump down to [## The solution](#the-solution) part below.

## Context

As a fan of [WASM](https://webassembly.org/), [Firefly Zero](https://fireflyzero.com),
and of "hipster languages" (like [MoonBit](https://www.moonbitlang.com/), [Crystal](https://crystal-lang.org/), [CUE](https://cuelang.org/)),
then this intersection of "Firefly &times; Odin" really sparks my joy.

Firefly Zero has a [firefly-odin SDK](https://github.com/firefly-zero/firefly-odin)
but they intend the developer to use Odin's [`contextless` calling convention](https://odin-lang.org/docs/overview/#calling-conventions)
everywhere. But that irks me, as I want to use Odin in the "normal way"
(dare I say: "idiomatic way"?).

```odin
// what i don't want to use
my_func_1 :: proc "contextless" () {
  // ...
}

// I want "odin" calling convention
my_func_2 :: proc () {
  // ...
}
```

Adding `"contextless"` everywhere isn't the end of the world. But the Odin
standard library uses `"odin"` (default) everywhere.

## The problem

You can opt-in to using `context`. For example:

```odin
my_func_setup_context :: proc "contextless" () {
  context = runtime.default_context()
  my_func_with_context()
}

my_func_with_context :: proc () {
  // Allocate 128 byte array using allocator from context
  stuff := make([]byte, 128)
  defer delete(stuff)
}
```

But for me this didn't even work, as Odin doesn't seem to provide a
default allocator in `freestanding_wasm32`. So `my_func_setup_context` must
instead be:

```odin
my_func_setup_context :: proc "contextless" () {
  context = runtime.default_context()
  when (ODIN_ARCH == .wasm32) {
    default_context.allocator = runtime.default_wasm_allocator()
  }
  my_func_with_context()
}
```

The real problem however is the fact that `runtime.default_context()`
sets up a brand new `context` each time.

We could in theory do this:

```odin
default_context: runtime.Context

init_default_context :: proc "contextless" () {
	default_context = runtime.default_context()
	when (ODIN_ARCH == .wasm32) {
		context = default_context
		default_context.allocator = runtime.default_wasm_allocator()
	}
}

default_context_ptr :: proc "contextless" () -> ^runtime.Context {
	return &default_context
}

@(export)
boot :: proc "contextless" () {
  context = default_context
  // ...
}

@(export)
update :: proc "contextless" () {
  context = default_context
  // ...
}

@(export)
render :: proc "contextless" () {
  context = default_context
  // ...
}
```

(`boot`, `update`, and `render` are [Firefly Zero callback](https://docs.fireflyzero.com/dev/callbacks/))

But when analyzing the compiled output (e.g via [wabt's `wasm2wat`](https://github.com/WebAssembly/wabt)
or [binaryen's `wasm-dis`](https://github.com/WebAssembly/binaryen)),
then we see that Odin is still calling `runtime::_core.odin_::__init_context`
in `boot` and `render`, which is where the overhead is coming from.
We want to just blindly reuse the global `default_context`.
(WASM is single-threaded, so we don't have to worry about race conditions)

In Firefly Zero, the Firefly runtime calls a set of functions rapidly, up to
60 times per second. Shaving off this context setup on each
`update` and `render` can actually save a substantial amount of processing,
especially in Firefly Zero's case where it's running on a WASM interpretor
on a low-powered [ESP32](https://www.espressif.com/en/products/socs/esp32) chip.

Now to be real, the amount of overhead is still minimal.
Using Firefly's `ff runtime monitor`, the overhead is only around ~150 fuel
(an approximation of processing cost provided by [WASMI](https://github.com/wasmi-labs/wasmi))

But when I see a problem, and a path to solution, then I cannot rest.

## The inspiration

Taking inspiration from how Odin deals with this when targeting WASM+JavaScript
(`ODIN_OS.JS`), they set up the context only once, get a pointer to it, and then
from JavaScript they follow the `odin` calling convention by passing that
pointer to every Odin procedure in WASM. For example:

```javascript
// JavaScript glue code
// "exports" is the "WebAssembly.instantiate(...).instance.exports"
if (exports.step) {
  const odin_ctx = exports.default_context_ptr();

  function step(currTimeStamp) {
    // ...
    const dt = (currTimeStamp - prevTimeStamp) * 0.001;
    if (!exports.step(dt, odin_ctx)) {
      // ...
    }
  }
}
```

Source: [`core/sys/wasm/js/odin.js`](https://github.com/odin-lang/Odin/blob/dev-2026-09/core/sys/wasm/js/odin.js#L2241-L2288)

The exported `step` procedure would then be defined in Odin like so:

```odin
// no "contextless" thanks to JavaScript passing "odin_ctx"
@(export)
step :: proc(delta_time: f64) -> bool {
  // ...
}
```

The `default_context_ptr` is defined in Odin's [`base/runtime/procs_js.odin`](https://github.com/odin-lang/Odin/blob/dev-2026-09/base/runtime/procs_js.odin).
Together with where the `init_default_context` sets up the default context to
be reused, and runs on `@(init)`.

## The solution

I couldn't get `@(init)` to work on `freestanding_wasm32` target. So we will
need to trigger that fucntion in another way.

I've defined the following in my Odin package:

```odin
default_context: runtime.Context

@(export)
init_default_context :: proc "contextless" () {
	default_context = runtime.default_context()
	when (ODIN_ARCH == .wasm32) {
		context = default_context
		default_context.allocator = runtime.default_wasm_allocator()
	}
}

@(export)
default_context_ptr :: proc "contextless" () -> ^runtime.Context {
	return &default_context
}
```

Now to trigger it, as explained above, using `context = default_context_ptr()`
doesn't compile to the correct result.

So we'll write our own glue code. Since the logic is so simple, then we can
write it in [WebAssembly text format (`.wat`)](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format):

```wasm
(module $init
  (import "app" "init_default_context" (func $app.init_default_context))
  (import "app" "default_context_ptr" (func $app.default_context_ptr (result i32)))
  (import "app" "boot_context" (func $app.boot_context (param i32)))
  (import "app" "render_context" (func $app.render_context (param i32)))
  (export "boot" (func $boot))
  (export "render" (func $render))
  (func $boot
    (call $app.init_default_context)
    (call $app.boot_context
      (call $app.default_context_ptr)))
  (func $render
    (call $app.render_context
      (call $app.default_context_ptr))))
```

We are importing `init_default_context` and `default_context_ptr` from the
Odin app code. We are also importing `boot_context` and `render_context` as
the `boot` and `render` equivalent [Firefly Zero callbacks](https://docs.fireflyzero.com/dev/callbacks/),
but using the `"odin"` calling convention. If we want more callbacks
(or other callbacks in case you're using something else), then you need to
remember to add them to this WAT file.

So we need to add the following to our Odin script:

```odin
@(export)
boot_context :: proc() {
	// boot with context :D
}

@(export)
render_context :: proc() {
	// render with context :D
}
```

The Odin script must be built into WASM, which can be done with:

```bash
odin build . -target:freestanding_wasm32 -out:my-app.wasm
```

We then _merge_ these two WASM modules together (one from Odin, one from our own WAT script) using [binaryen's `wasm-merge`](https://github.com/WebAssembly/binaryen).
In its simplest form, you just give it the module paths:

```bash
wasm-merge <module-1-path> <module-1-name> <module-2-path> <module-2-name> -o build/app.wasm
```

(`wasm-merge` supprts reading from a mix of `.wat` and `.wasm` files)

The `module-*-name` parameters defines the "WASM module name" used when
cross-referencing imports. So given our `.wat` script above, then we want to
name our Odin WASM module as `app`.

In my case, with Firefly Zero, I also need to enable a bunch of WASM features.
So my final `wasm-merge` becomes:

```bash
wasm-merge ./my-script.wat init build/my-app.wasm app \
  -o build/merged.wasm \
  --disable-exception-handling \
  --disable-gc \
  --enable-bulk-memory \
  --enable-extended-const \
  --enable-memory64 \
  --enable-multivalue \
  --enable-mutable-globals \
  --enable-nontrapping-float-to-int \
  --enable-reference-types \
  --enable-relaxed-simd \
  --enable-sign-ext \
  --enable-tail-call \
  --debuginfo
```

The final step would be to also run a final `wasm-opt`:

```bash
wasm-opt build/merged.wasm \
  -o build/merged-optimized.wasm \
  -Os \
  --dae-optimizing \
  --disable-exception-handling \
  --disable-gc \
  --enable-bulk-memory \
  --enable-extended-const \
  --enable-memory64 \
  --enable-multivalue \
  --enable-mutable-globals \
  --enable-nontrapping-float-to-int \
  --enable-reference-types \
  --enable-relaxed-simd \
  --enable-sign-ext \
  --enable-tail-call \
  --strip-debug \
  --strip-dwarf \
  --strip-producers
```

And that's it :)

## Bonus

Best is to toss these command-lines into something like a `Makefile`, a [justfile](https://just.systems/),
a [Taskfile.yml](https://taskfile.dev/), or a [mise.toml](https://mise.jdx.dev/tasks/#tasks-in-mise-toml-files).

Personally I prefer `mise.toml`, as with [mise-en-place](https://mise.jdx.dev/)
you can also define all the dependencies you need, such as the binaryen ones:

```toml
[tools]
odin = "dev-2026-09"

# for wasm-merge, wasm-opt, and wasm-dis
"aqua:WebAssembly/binaryen" = "latest"
# needed for Odin to compile to WASM
"github:WebAssembly/wasi-sdk" = "latest"

# Firefly Zero tooling
"github:firefly-zero/firefly-cli" = { version = "0.19.0", rename_exe = "ff" }
"github:firefly-zero/firefly-emulator" = "0.13.0"

[env]
# this tells Odin where to find "WebAssembly/wasi-sdk"
WASI_SDK_PATH = { default = """{{ tools["github:WebAssembly/wasi-sdk"].path }}""", tools = true }
```
