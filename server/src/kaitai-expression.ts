import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export interface ExprToken {
	type: ExprTokenType;
	value: string;
	offset: number;
}

export enum ExprTokenType {
	Number,
	String,
	Identifier,
	Operator,
	Dot,
	DoubleColon,
	LParen,
	RParen,
	LBracket,
	RBracket,
	Comma,
	Ternary,
	Colon,
	EOF,
}

const KEYWORDS = new Set(['true', 'false', 'not', 'or', 'and', 'sizeof', 'as']);
const SPECIAL_IDENTIFIERS = new Set(['_parent', '_io', '_root', '_index', '_']);

const OPERATORS = [
	'!=', '==', '<=', '>=', '<<', '>>', '||', '&&',
	'+', '-', '*', '/', '%', '&', '|', '^', '~',
	'<', '>', '!',
];

function isAlpha(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isDigit(c: string): boolean {
	return c >= '0' && c <= '9';
}

function isAlphaNum(c: string): boolean {
	return isAlpha(c) || isDigit(c);
}

function isWhitespace(c: string): boolean {
	return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

export function tokenize(text: string): ExprToken[] {
	const tokens: ExprToken[] = [];
	let i = 0;

	while (i < text.length) {
		const c = text[i];

		if (isWhitespace(c)) {
			i++;
			continue;
		}

		if (isAlpha(c)) {
			const start = i;
			while (i < text.length && isAlphaNum(text[i])) i++;
			tokens.push({ type: ExprTokenType.Identifier, value: text.substring(start, i), offset: start });
			continue;
		}

		if (isDigit(c)) {
			const start = i;
			if (c === '0' && i + 1 < text.length) {
				const next = text[i + 1];
				if (next === 'x' || next === 'X') {
					i += 2;
					while (i < text.length && /[0-9a-fA-F]/.test(text[i])) i++;
					tokens.push({ type: ExprTokenType.Number, value: text.substring(start, i), offset: start });
					continue;
				}
				if (next === 'b' || next === 'B') {
					i += 2;
					while (i < text.length && (text[i] === '0' || text[i] === '1')) i++;
					tokens.push({ type: ExprTokenType.Number, value: text.substring(start, i), offset: start });
					continue;
				}
				if (next === 'o' || next === 'O') {
					i += 2;
					while (i < text.length && text[i] >= '0' && text[i] <= '7') i++;
					tokens.push({ type: ExprTokenType.Number, value: text.substring(start, i), offset: start });
					continue;
				}
			}
			while (i < text.length && isDigit(text[i])) i++;
			if (i < text.length && text[i] === '.') {
				i++;
				while (i < text.length && isDigit(text[i])) i++;
			}
			tokens.push({ type: ExprTokenType.Number, value: text.substring(start, i), offset: start });
			continue;
		}

		if (c === '"') {
			const start = i;
			i++;
			while (i < text.length && text[i] !== '"') {
				if (text[i] === '\\') i++;
				i++;
			}
			if (i < text.length) i++; // closing quote
			tokens.push({ type: ExprTokenType.String, value: text.substring(start, i), offset: start });
			continue;
		}

		if (c === '\'') {
			const start = i;
			i++;
			while (i < text.length && text[i] !== '\'') {
				if (text[i] === '\\') i++;
				i++;
			}
			if (i < text.length) i++;
			tokens.push({ type: ExprTokenType.String, value: text.substring(start, i), offset: start });
			continue;
		}

		if (c === ':' && i + 1 < text.length && text[i + 1] === ':') {
			tokens.push({ type: ExprTokenType.DoubleColon, value: '::', offset: i });
			i += 2;
			continue;
		}

		if (c === '.') {
			tokens.push({ type: ExprTokenType.Dot, value: '.', offset: i });
			i++;
			continue;
		}

		if (c === '(') { tokens.push({ type: ExprTokenType.LParen, value: '(', offset: i }); i++; continue; }
		if (c === ')') { tokens.push({ type: ExprTokenType.RParen, value: ')', offset: i }); i++; continue; }
		if (c === '[') { tokens.push({ type: ExprTokenType.LBracket, value: '[', offset: i }); i++; continue; }
		if (c === ']') { tokens.push({ type: ExprTokenType.RBracket, value: ']', offset: i }); i++; continue; }
		if (c === ',') { tokens.push({ type: ExprTokenType.Comma, value: ',', offset: i }); i++; continue; }
		if (c === '?') { tokens.push({ type: ExprTokenType.Ternary, value: '?', offset: i }); i++; continue; }
		if (c === ':') { tokens.push({ type: ExprTokenType.Colon, value: ':', offset: i }); i++; continue; }

		// Try multi-char operators first
		let matched = false;
		for (const op of OPERATORS) {
			if (text.startsWith(op, i)) {
				tokens.push({ type: ExprTokenType.Operator, value: op, offset: i });
				i += op.length;
				matched = true;
				break;
			}
		}
		if (matched) continue;

		// Unknown character — return tokens so far plus error token
		tokens.push({ type: ExprTokenType.Identifier, value: text[i], offset: i });
		i++;
	}

	return tokens;
}

export interface ExpressionError {
	message: string;
	offset: number;
	length: number;
}

export function validateExpression(text: string): ExpressionError[] {
	const errors: ExpressionError[] = [];
	if (!text || text.trim().length === 0) return errors;

	let tokens: ExprToken[];
	try {
		tokens = tokenize(text);
	} catch {
		errors.push({ message: 'Failed to tokenize expression', offset: 0, length: text.length });
		return errors;
	}

	if (tokens.length === 0) return errors;

	// Check balanced parentheses and brackets
	let parenDepth = 0;
	let bracketDepth = 0;
	const parenStack: ExprToken[] = [];
	const bracketStack: ExprToken[] = [];

	for (const token of tokens) {
		if (token.type === ExprTokenType.LParen) {
			parenDepth++;
			parenStack.push(token);
		} else if (token.type === ExprTokenType.RParen) {
			parenDepth--;
			if (parenDepth < 0) {
				errors.push({ message: 'Unmatched closing parenthesis', offset: token.offset, length: 1 });
				parenDepth = 0;
			} else {
				parenStack.pop();
			}
		} else if (token.type === ExprTokenType.LBracket) {
			bracketDepth++;
			bracketStack.push(token);
		} else if (token.type === ExprTokenType.RBracket) {
			bracketDepth--;
			if (bracketDepth < 0) {
				errors.push({ message: 'Unmatched closing bracket', offset: token.offset, length: 1 });
				bracketDepth = 0;
			} else {
				bracketStack.pop();
			}
		}
	}

	for (const t of parenStack) {
		errors.push({ message: 'Unmatched opening parenthesis', offset: t.offset, length: 1 });
	}
	for (const t of bracketStack) {
		errors.push({ message: 'Unmatched opening bracket', offset: t.offset, length: 1 });
	}

	// Check for empty parens in non-function contexts and consecutive operators
	for (let i = 0; i < tokens.length - 1; i++) {
		const curr = tokens[i];
		const next = tokens[i + 1];

		// Consecutive binary operators (excluding unary - and ~)
		if (curr.type === ExprTokenType.Operator && next.type === ExprTokenType.Operator) {
			if (curr.value !== '!' && curr.value !== '~' && next.value !== '-' && next.value !== '~' && next.value !== '!') {
				errors.push({
					message: `Unexpected operator '${next.value}' after '${curr.value}'`,
					offset: next.offset,
					length: next.value.length,
				});
			}
		}
	}

	// Check expression doesn't end with a binary operator
	const last = tokens[tokens.length - 1];
	if (last.type === ExprTokenType.Operator || last.type === ExprTokenType.Dot || last.type === ExprTokenType.DoubleColon) {
		if (last.value !== '!' && last.value !== '~') {
			errors.push({
				message: `Expression ends with operator '${last.value}'`,
				offset: last.offset,
				length: last.value.length,
			});
		}
	}

	// Check for dot followed by non-identifier
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].type === ExprTokenType.Dot) {
			const next = tokens[i + 1];
			if (next.type !== ExprTokenType.Identifier) {
				errors.push({
					message: `Expected identifier after '.'`,
					offset: next.offset,
					length: next.value.length,
				});
			}
		}
	}

	// Check for :: followed by non-identifier
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i].type === ExprTokenType.DoubleColon) {
			const next = tokens[i + 1];
			if (next.type !== ExprTokenType.Identifier) {
				errors.push({
					message: `Expected identifier after '::'`,
					offset: next.offset,
					length: next.value.length,
				});
			}
		}
	}

	return errors;
}

/** Keys whose YAML values are Kaitai expressions */
export const EXPRESSION_KEYS = new Set([
	'size', 'repeat-expr', 'repeat-until', 'if',
	'pos', 'io', 'value', 'switch-on',
]);

export function isKeyword(value: string): boolean {
	return KEYWORDS.has(value);
}

export function isSpecialIdentifier(value: string): boolean {
	return SPECIAL_IDENTIFIERS.has(value);
}
