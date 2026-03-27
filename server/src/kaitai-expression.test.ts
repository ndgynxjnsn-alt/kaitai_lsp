import { describe, it, expect } from 'vitest';
import { tokenize, validateExpression, ExprTokenType, isKeyword, isSpecialIdentifier, EXPRESSION_KEYS } from './kaitai-expression';

describe('tokenize', () => {
	it('tokenizes simple identifiers', () => {
		const tokens = tokenize('foo');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Identifier, value: 'foo', offset: 0 });
	});

	it('tokenizes dotted access', () => {
		const tokens = tokenize('a.b');
		expect(tokens).toHaveLength(3);
		expect(tokens[0].type).toBe(ExprTokenType.Identifier);
		expect(tokens[1].type).toBe(ExprTokenType.Dot);
		expect(tokens[2].type).toBe(ExprTokenType.Identifier);
	});

	it('tokenizes double colon (enum path)', () => {
		const tokens = tokenize('my_enum::value');
		expect(tokens).toHaveLength(3);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Identifier, value: 'my_enum', offset: 0 });
		expect(tokens[1]).toEqual({ type: ExprTokenType.DoubleColon, value: '::', offset: 7 });
		expect(tokens[2]).toEqual({ type: ExprTokenType.Identifier, value: 'value', offset: 9 });
	});

	it('tokenizes decimal numbers', () => {
		const tokens = tokenize('42');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Number, value: '42', offset: 0 });
	});

	it('tokenizes float numbers', () => {
		const tokens = tokenize('3.14');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Number, value: '3.14', offset: 0 });
	});

	it('tokenizes hex numbers', () => {
		const tokens = tokenize('0xFF');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Number, value: '0xFF', offset: 0 });
	});

	it('tokenizes binary numbers', () => {
		const tokens = tokenize('0b1010');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Number, value: '0b1010', offset: 0 });
	});

	it('tokenizes octal numbers', () => {
		const tokens = tokenize('0o77');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toEqual({ type: ExprTokenType.Number, value: '0o77', offset: 0 });
	});

	it('tokenizes double-quoted strings', () => {
		const tokens = tokenize('"hello"');
		expect(tokens).toHaveLength(1);
		expect(tokens[0].type).toBe(ExprTokenType.String);
		expect(tokens[0].value).toBe('"hello"');
	});

	it('tokenizes single-quoted strings', () => {
		const tokens = tokenize("'world'");
		expect(tokens).toHaveLength(1);
		expect(tokens[0].type).toBe(ExprTokenType.String);
		expect(tokens[0].value).toBe("'world'");
	});

	it('tokenizes strings with escape sequences', () => {
		const tokens = tokenize('"he\\"llo"');
		expect(tokens).toHaveLength(1);
		expect(tokens[0].type).toBe(ExprTokenType.String);
	});

	it('tokenizes multi-char operators', () => {
		const tokens = tokenize('a == b');
		expect(tokens).toHaveLength(3);
		expect(tokens[1]).toEqual({ type: ExprTokenType.Operator, value: '==', offset: 2 });
	});

	it('tokenizes all comparison operators', () => {
		for (const op of ['==', '!=', '<=', '>=', '<<', '>>', '||', '&&']) {
			const tokens = tokenize(`a ${op} b`);
			expect(tokens[1].value).toBe(op);
			expect(tokens[1].type).toBe(ExprTokenType.Operator);
		}
	});

	it('tokenizes single-char operators', () => {
		for (const op of ['+', '-', '*', '/', '%', '&', '|', '^', '~', '<', '>', '!']) {
			const tokens = tokenize(`a ${op} b`);
			expect(tokens[1].value).toBe(op);
			expect(tokens[1].type).toBe(ExprTokenType.Operator);
		}
	});

	it('tokenizes parentheses', () => {
		const tokens = tokenize('(a)');
		expect(tokens[0].type).toBe(ExprTokenType.LParen);
		expect(tokens[2].type).toBe(ExprTokenType.RParen);
	});

	it('tokenizes brackets', () => {
		const tokens = tokenize('a[0]');
		expect(tokens[1].type).toBe(ExprTokenType.LBracket);
		expect(tokens[3].type).toBe(ExprTokenType.RBracket);
	});

	it('tokenizes ternary operator', () => {
		const tokens = tokenize('a ? b : c');
		expect(tokens[1].type).toBe(ExprTokenType.Ternary);
		expect(tokens[3].type).toBe(ExprTokenType.Colon);
	});

	it('tokenizes comma', () => {
		const tokens = tokenize('a, b');
		expect(tokens[1].type).toBe(ExprTokenType.Comma);
	});

	it('skips whitespace', () => {
		const tokens = tokenize('  a  +  b  ');
		expect(tokens).toHaveLength(3);
	});

	it('tokenizes complex expression', () => {
		const tokens = tokenize('_io.eof or _.block_type == block_type::end_of_file');
		const values = tokens.map(t => t.value);
		expect(values).toEqual([
			'_io', '.', 'eof', 'or', '_', '.', 'block_type', '==',
			'block_type', '::', 'end_of_file',
		]);
	});

	it('tokenizes bitwise expression', () => {
		const tokens = tokenize('2 << (flags & 7)');
		const values = tokens.map(t => t.value);
		expect(values).toEqual(['2', '<<', '(', 'flags', '&', '7', ')']);
	});

	it('tokenizes sizeof', () => {
		const tokens = tokenize('sizeof<my_type>');
		expect(tokens[0]).toEqual({ type: ExprTokenType.Identifier, value: 'sizeof', offset: 0 });
	});
});

describe('validateExpression', () => {
	it('returns no errors for valid expressions', () => {
		const validExpressions = [
			'42',
			'a + b',
			'a.b.c',
			'foo::bar',
			'_parent.size',
			'_io.eof',
			'_root.header.length',
			'_index',
			'a == b',
			'a != b',
			'not flag',
			'a or b',
			'a and b',
			'a ? b : c',
			'arr[0]',
			'(a + b) * c',
			'_io.eof or _.block_type == block_type::end_of_file',
			'2 << (flags & 7)',
			'true',
			'false',
			'0xFF',
			'0b1010',
			'0o77',
			'3.14',
			'"hello"',
			"'world'",
			'a as my_type',
			'~mask',
			'!flag',
		];

		for (const expr of validExpressions) {
			const errors = validateExpression(expr);
			expect(errors, `Expected no errors for: ${expr}`).toEqual([]);
		}
	});

	it('returns no errors for empty/whitespace input', () => {
		expect(validateExpression('')).toEqual([]);
		expect(validateExpression('   ')).toEqual([]);
	});

	it('detects unmatched opening parenthesis', () => {
		const errors = validateExpression('(a + b');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('Unmatched opening parenthesis');
		expect(errors[0].offset).toBe(0);
	});

	it('detects unmatched closing parenthesis', () => {
		const errors = validateExpression('a + b)');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('Unmatched closing parenthesis');
	});

	it('detects unmatched opening bracket', () => {
		const errors = validateExpression('a[0');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('Unmatched opening bracket');
	});

	it('detects unmatched closing bracket', () => {
		const errors = validateExpression('a]');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('Unmatched closing bracket');
	});

	it('detects consecutive binary operators', () => {
		const errors = validateExpression('a + + b');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("Unexpected operator '+' after '+'");
	});

	it('allows unary minus after operator', () => {
		const errors = validateExpression('a + -b');
		expect(errors).toEqual([]);
	});

	it('allows unary not (!) after operator', () => {
		const errors = validateExpression('a + !b');
		expect(errors).toEqual([]);
	});

	it('allows unary bitwise not (~) after operator', () => {
		const errors = validateExpression('a + ~b');
		expect(errors).toEqual([]);
	});

	it('detects trailing binary operator', () => {
		const errors = validateExpression('a +');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("Expression ends with operator '+'");
	});

	it('detects trailing dot', () => {
		const errors = validateExpression('foo.');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("Expression ends with operator '.'");
	});

	it('detects trailing double colon', () => {
		const errors = validateExpression('bar::');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("Expression ends with operator '::'");
	});

	it('detects non-identifier after dot', () => {
		const errors = validateExpression('a.+');
		expect(errors.some(e => e.message.includes("Expected identifier after '.'"))).toBe(true);
	});

	it('detects non-identifier after double colon', () => {
		const errors = validateExpression('a::+');
		expect(errors.some(e => e.message.includes("Expected identifier after '::'"))).toBe(true);
	});

	it('handles multiple errors', () => {
		const errors = validateExpression('(a +');
		expect(errors.length).toBeGreaterThanOrEqual(2);
		const messages = errors.map(e => e.message);
		expect(messages.some(m => m.includes('Unmatched opening parenthesis'))).toBe(true);
		expect(messages.some(m => m.includes('Expression ends with operator'))).toBe(true);
	});
});

describe('isKeyword', () => {
	it('recognizes keywords', () => {
		for (const kw of ['true', 'false', 'not', 'or', 'and', 'sizeof', 'as']) {
			expect(isKeyword(kw), kw).toBe(true);
		}
	});

	it('rejects non-keywords', () => {
		expect(isKeyword('foo')).toBe(false);
		expect(isKeyword('if')).toBe(false);
	});
});

describe('isSpecialIdentifier', () => {
	it('recognizes special identifiers', () => {
		for (const id of ['_parent', '_io', '_root', '_index', '_']) {
			expect(isSpecialIdentifier(id), id).toBe(true);
		}
	});

	it('rejects non-special identifiers', () => {
		expect(isSpecialIdentifier('foo')).toBe(false);
		expect(isSpecialIdentifier('_bar')).toBe(false);
	});
});

describe('EXPRESSION_KEYS', () => {
	it('contains all expression keys', () => {
		const expected = ['size', 'repeat-expr', 'repeat-until', 'if', 'pos', 'io', 'value', 'switch-on'];
		for (const key of expected) {
			expect(EXPRESSION_KEYS.has(key), key).toBe(true);
		}
	});
});
