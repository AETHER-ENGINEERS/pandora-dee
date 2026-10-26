<!-- id: playbook-language | parent: playbooks | level: 3 | order: 18 | tags: expression, template, jinja, filters, functions, when, until, variables, secrets -->
# The expression language

Playbook strings are templates: `{{ price | float * 2 }}`. The same small language is used bare in `when`, `until`, `failed_when`, `loop` and `assert.that`. It is a safe interpreter (no JavaScript is evaluated): only variables, literals, the operators and the functions below.

## Values and names

Numbers, `"strings"` or `'strings'`, `true`, `false`, `null`, lists `[1, 2]`. Variables come from the playbook's `vars`, the run's `vars`, `register`, `set`, `loop_var` and `index`; then secrets. Paths: `a.b.c`, `list[0]`, `obj["key"]`. An undefined name is an **error** (not an empty string), except under `is defined` and `default`. `__proto__`, `constructor` and `prototype` are unreachable.

## Operators

`+ - * / %` (`+` joins strings and lists; two numbers or numeric strings add), `== != < <= > >=` (numbers compare as numbers, even when one is a numeric string like `"10"`), `and or not` (also `&& || !`), `in` and `not in` (list member, substring or object key), `x is defined`, `x is not defined`, parentheses. Truthiness: empty list, empty object, `0`, `""`, `null` and undefined are false.

## Filters and functions

`x | f(args)` is the same as `f(x, args)`. Available: `len` (`length`, `count`), `lower`, `upper`, `trim`, `str`, `int`, `float` (strips currency symbols, so `"$12.50"` gives 12.5), `join(list, sep)`, `split(text, sep)`, `first`, `last`, `keys`, `values`, `replace`, `startswith`, `endswith`, `contains`, `matches(text, regex)`, `regex_find(text, regex, group)`, `json`, `from_json`, `sort`, `unique`, `reverse`, `abs`, `round`, `min`, `max`, `range(n)` or `range(a, b)` (capped at 1000), `now()`, `today()`, `random_int(a, b)`, `default(x, fallback)`, `defined(x)`. Regular expressions are limited to 200 characters, the text they search to 100000, and patterns that can take forever (a repeated group containing a repeat or an alternation, such as `(a+)+`) are refused, because a running regular expression cannot be interrupted. An unknown function is an error that lists the available ones.

## Literal braces

A string containing `{{` is always read as a template. To write the characters themselves, make them an expression: `{{ "{{" }}`.

## Where each is evaluated

| Where | How |
|---|---|
| Any task string | `{{ }}` templates, evaluated when the task starts (once, not again on retries). |
| `when`, `until`, `failed_when`, `assert.that`, `loop` | bare expressions. `until` and `failed_when` also see `result`. |
| `block`, `rescue`, `always` | their tasks are evaluated as they run, not up front. |

Mistakes are reported before anything runs: `validate` (and the tab's Check button) parses every expression and names the task.
