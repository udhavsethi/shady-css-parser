/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

import {AtRule, Comment, Declaration, Discarded, Rule, Rulelist, Ruleset, Stylesheet} from './common';
import {NodeFactory} from './node-factory';
import {Token} from './token';
import {Tokenizer} from './tokenizer';

/**
 * Class that implements a shady CSS parser.
 */
class Parser {
  nodeFactory: NodeFactory;

  /**
   * Create a Parser instance. When creating a Parser instance, a specialized
   * NodeFactory can be supplied to implement streaming analysis and
   * manipulation of the CSS AST.
   */
  constructor(nodeFactory = new NodeFactory()) {
    this.nodeFactory = nodeFactory;
  }

  /**
   * Parse CSS and generate an AST.
   * @param cssText The CSS to parse.
   * @return A CSS AST containing nodes that correspond to those
   *     generated by the Parser's NodeFactory.
   */
  parse(cssText: string): Stylesheet {
    return this.parseStylesheet(new Tokenizer(cssText));
  }

  /**
   * Consumes tokens from a Tokenizer to parse a Stylesheet node.
   * @param tokenizer A Tokenizer instance.
   */
  parseStylesheet(tokenizer: Tokenizer): Stylesheet {
    return this.nodeFactory.stylesheet(this.parseRules(tokenizer));
  }

  /**
   * Consumes tokens from a Tokenizer to parse a sequence of rules.
   * @param tokenizer A Tokenizer instance.
   * @return A list of nodes corresponding to rules. For a parser
   *   configured with a basic NodeFactory, any of Comment, AtRule, Ruleset,
   *   Declaration and Discarded nodes may be present in the list.
   */
  parseRules(tokenizer: Tokenizer): Rule[] {
    let rules = [];

    while (tokenizer.currentToken) {
      let rule = this.parseRule(tokenizer);

      if (rule) {
        rules.push(rule);
      }
    }

    return rules;
  }

  /**
   * Consumes tokens from a Tokenizer to parse a single rule.
   * @param tokenizer A Tokenizer instance.
   * @return If the current token in the Tokenizer is whitespace,
   *   returns null. Otherwise, returns the next parseable node.
   */
  parseRule(tokenizer: Tokenizer): Rule|null {
    // Trim leading whitespace:
    const token = tokenizer.currentToken;
    if (token === null) {
      return null;
    }
    if (token.is(Token.type.whitespace)) {
      tokenizer.advance();
      return null;

    } else if (token.is(Token.type.comment)) {
      return this.parseComment(tokenizer);

    } else if (token.is(Token.type.word)) {
      return this.parseDeclarationOrRuleset(tokenizer);

    } else if (token.is(Token.type.propertyBoundary)) {
      return this.parseUnknown(tokenizer);

    } else if (token.is(Token.type.at)) {
      return this.parseAtRule(tokenizer);

    } else {
      return this.parseUnknown(tokenizer);
    }
  }

  /**
   * Consumes tokens from a Tokenizer to parse a Comment node.
   * @param tokenizer A Tokenizer instance.
   */
  parseComment(tokenizer: Tokenizer): Comment | null {
    const token = tokenizer.advance();
    if (token === null) {
      return null;
    }
    return this.nodeFactory.comment(tokenizer.slice(token));
  }

  /**
   * Consumes tokens from a Tokenizer through the next boundary token to
   * produce a Discarded node. This supports graceful recovery from many
   * malformed CSS conditions.
   * @param tokenizer A Tokenizer instance.
   */
  parseUnknown(tokenizer: Tokenizer): Discarded | null {
    let start = tokenizer.advance();
    let end;

    if (start === null) {
      return null;
    }

    while (tokenizer.currentToken &&
           tokenizer.currentToken.is(Token.type.boundary)) {
      end = tokenizer.advance();
    }

    return this.nodeFactory.discarded(tokenizer.slice(start!, end));
  }

  /**
   * Consumes tokens from a Tokenizer to parse an At Rule node.
   * @param tokenizer A Tokenizer instance.
   */
  parseAtRule(tokenizer: Tokenizer): AtRule | null {
    let name = '';
    let rulelist = undefined;
    let parametersStart = undefined;
    let parametersEnd = undefined;

    while (tokenizer.currentToken) {
      if (tokenizer.currentToken.is(Token.type.whitespace)) {
        tokenizer.advance();
      } else if (!name && tokenizer.currentToken.is(Token.type.at)) {
        // Discard the @:
        tokenizer.advance();
        let start = tokenizer.currentToken;
        let end;

        while (tokenizer.currentToken &&
               tokenizer.currentToken.is(Token.type.word)) {
          end = tokenizer.advance();
        }
        name = tokenizer.slice(start, end);
      } else if (tokenizer.currentToken.is(Token.type.openBrace)) {
        rulelist = this.parseRulelist(tokenizer);
        break;
      } else if (tokenizer.currentToken.is(Token.type.propertyBoundary)) {
        tokenizer.advance();
        break;
      } else {
        if (parametersStart == null) {
          parametersStart = tokenizer.advance();
        } else {
          parametersEnd = tokenizer.advance();
        }
      }
    }

    return this.nodeFactory.atRule(
        name,
        parametersStart ? tokenizer.slice(parametersStart, parametersEnd) : '',
        rulelist || undefined);
  }

  /**
   * Consumes tokens from a Tokenizer to produce a Rulelist node.
   * @param tokenizer A Tokenizer instance.
   */
  parseRulelist(tokenizer: Tokenizer): Rulelist {
    let rules = [];

    // Take the opening { boundary:
    tokenizer.advance();

    while (tokenizer.currentToken) {
      if (tokenizer.currentToken.is(Token.type.closeBrace)) {
        tokenizer.advance();
        break;
      } else {
        let rule = this.parseRule(tokenizer);
        if (rule) {
          rules.push(rule);
        }
      }
    }

    return this.nodeFactory.rulelist(rules);
  }

  /**
   * Consumes tokens from a Tokenizer instance to produce a Declaration node or
   * a Ruleset node, as appropriate.
   * @param tokenizer A Tokenizer node.
   */
  parseDeclarationOrRuleset(tokenizer: Tokenizer): Ruleset | Declaration | null {
    let ruleStart = null;
    let ruleEnd = null;
    let colon = null;

    // This code is not obviously correct. e.g. there's what looks to be a
    // null-dereference if the declaration starts with an open brace or
    // property boundary.. though that may be impossible.

    while (tokenizer.currentToken) {
      if (tokenizer.currentToken.is(Token.type.whitespace)) {
        tokenizer.advance();
      } else if (tokenizer.currentToken.is(Token.type.openParenthesis)) {
        // skip until close paren
        while (tokenizer.currentToken &&
               !tokenizer.currentToken.is(Token.type.closeParenthesis)) {
          tokenizer.advance();
        }
      } else if (tokenizer.currentToken.is(Token.type.openBrace) ||
                 tokenizer.currentToken.is(Token.type.propertyBoundary)) {
        break;
      } else {
        if (tokenizer.currentToken.is(Token.type.colon)) {
          colon = tokenizer.currentToken;
        }

        if (ruleStart === null) {
          ruleStart = tokenizer.advance();
          ruleEnd = ruleStart;
        } else {
          ruleEnd = tokenizer.advance();
        }
      }
    }

    if (tokenizer.currentToken === null) {
      // terminated early
      return null;
    }
    // A ruleset never contains or ends with a semi-colon.
    if (tokenizer.currentToken.is(Token.type.propertyBoundary)) {
      let declarationName = tokenizer.slice(
          ruleStart!, colon ? colon.previous : ruleEnd);
      // TODO(cdata): is .trim() bad for performance?
      let expressionValue =
          colon && tokenizer.slice(colon.next!, ruleEnd).trim();

      if (tokenizer.currentToken.is(Token.type.semicolon)) {
        tokenizer.advance();
      }

      return this.nodeFactory.declaration(
          declarationName,
          expressionValue && this.nodeFactory.expression(expressionValue) || undefined);
    // This is the case for a mixin-like structure:
    } else if (colon && colon === ruleEnd) {
      let rulelist = this.parseRulelist(tokenizer);

      if (tokenizer.currentToken.is(Token.type.semicolon)) {
        tokenizer.advance();
      }

      return this.nodeFactory.declaration(
          tokenizer.slice(ruleStart!, ruleEnd.previous), rulelist);
    // Otherwise, this is a ruleset:
    } else {
      return this.nodeFactory.ruleset(
          tokenizer.slice(ruleStart!, ruleEnd),
          this.parseRulelist(tokenizer));
    }
  }
}

export { Parser };
