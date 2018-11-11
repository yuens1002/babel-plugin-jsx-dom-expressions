import reconcileArrays from './reconcileArrays';
import Attributes from '../Attributes'

function normalizeIncomingArray(normalized, array) {
  for (var i = 0, len = array.length; i < len; i++) {
    var item = array[i];
    if (item instanceof Node) {
        normalized.push(item);
    } else if (item == null || item === true || item === false) { // matches null, undefined, true or false
        // skip
    } else if (Array.isArray(item)) {
        normalizeIncomingArray(normalized, item);
    } else if (typeof item === 'string') {
        normalized.push(item);
    } else {
        normalized.push(item.toString());
    }
  }
  return normalized;
}

function appendNodes(parent, array) {
  for (let i = 0, len = array.length; i < len; i++) {
    let node = array[i];
    if (!(node instanceof Node))
      node = array[i] = document.createTextNode(node);
    parent.appendChild(node);
  }
}

function model(el) {
  let m = el.model, a = el.action, r;
  if (!m && el.parentNode) r = model(el.parentNode);
  return [m || r && r[0], a || r && r[1]];
}

export function createRuntime(options) {
  const { wrap } = options;

  function singleExpression(parent, value, current) {
    if (value === current) return current;
    const t = typeof value;
    if (t === 'string') {
      if (current !== '' && typeof current === 'string') {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    } else if ('number' === t) {
      value = value.toString()
      if (current !== "" && typeof current === 'string') {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    } else if (value == null || value === '' || t === 'boolean') {
      current = parent.textContent = '';
    } else if (t === 'function') {
      wrap(function() { current = singleExpression(parent, value(), current); });
    } else if (value instanceof Node) {
      if (Array.isArray(current)) {
        if (current.length === 0) {
          parent.appendChild(value);
        } else if (current.length === 1) {
          parent.replaceChild(value, current[0]);
        } else {
          parent.textContent = '';
          parent.appendChild(value);
        }
      } else if (current == null || current === '') {
        parent.appendChild(value);
      } else {
        parent.replaceChild(value, parent.firstChild);
      }
      current = value;
    } else if (Array.isArray(value)) {
      let array = normalizeIncomingArray([], value);
      if (array.length === 0) {
        parent.textContent = '';
      } else {
        if (Array.isArray(current)) {
          if (current.length === 0) {
            appendNodes(parent, array);
          } else {
            reconcileArrays(parent, current, array);
          }
        } else if (current == null || current === '') {
          appendNodes(parent, array);
        } else {
          reconcileArrays(parent, [parent.firstChild], array);
        }
      }
      current = array;
    } else {
      throw new Error("content must be Node, stringable, or array of same");
    }

    return current;
  }

  function multipleExpressions(parent, value, nodes) {
    let marker = null;
    const t = typeof value;
    parent = (nodes[0] && nodes[0].parentNode) ? nodes[0].parentNode : parent;
    if (t === 'string' || t === 'number') {
      if (nodes[0].nodeType === 3) {
        nodes[0].data = value.toString();
        marker = nodes[0];
      } else {
        value = document.createTextNode(value.toString());
        if (nodes[0]) {
          parent.replaceChild(value, nodes[0]);
        } else parent.appendChild(value);
        nodes[0] = marker = value;
      }
    } else if (t === 'function') {
      wrap(function() { nodes = multipleExpressions(parent, value(), nodes); });
      marker = nodes[nodes.length - 1];
    } else if (value instanceof Node) {
      if (nodes[0]) {
        if (nodes[0] !== value) parent.replaceChild(value, nodes[0]);
      } else parent.appendChild(value);
      nodes[0] = marker = value;
    } else if (Array.isArray(value)) {
      const array = normalizeIncomingArray([], value);
      if (array.length) {
        if (nodes.length === 1) {
          let next = nodes[0].nextSibling;
          nodes[0].remove();
          for (let i = 0, len = array.length; i < len; i++) {
            let node = array[i];
            if (!(node instanceof Node))
              node = nodes[i] = document.createTextNode(node);
            parent.insertBefore(node, next);
            nodes[i] = node;
          }
          marker = nodes[array.length - 1];
        } else {
          reconcileArrays(parent, nodes, array, true);
          nodes = array;
          marker = nodes[nodes.length - 1];
        }
      }
    }
    // handle nulls
    if (marker == null) {
      if (nodes[0] === parent.firstChild && nodes.length > 1 && nodes[nodes.length - 1] === parent.lastChild) {
        parent.textContent = '';
        value = document.createTextNode('');
        parent.appendChild(value);
        marker = nodes[0] = value;
        nodes.length = 1;
      } else if (nodes[0].nodeType === 3) {
        nodes[0].data = '';
        marker = nodes[0];
      } else {
        value = document.createTextNode('');
        if (nodes[0])
          parent.replaceChild(value, nodes[0]);
        else parent.appendChild(value);
        marker = nodes[0] = value;
      }
    }

    // trim extras
    let node;
    while (marker !== (node = nodes[nodes.length - 1])) {
      parent.removeChild(node);
      nodes.length = nodes.length - 1;
    }
    return nodes;
  }

  return Object.assign({
    insert(parent, accessor, init) {
      if (typeof accessor !== 'function') return singleExpression(parent, accessor, init);
      wrap((current = init) => singleExpression(parent, accessor(), current));
    },
    insertM(parent, accessor, init) {
      if (typeof accessor !== 'function') return multipleExpressions(parent, accessor, init);
      wrap((current = init) => multipleExpressions(parent, accessor(), current));
    },
    addEventListener(node, eventName, handler) {
      node.addEventListener(eventName, e => {
        if (handler.length < 2) return handler(e);
        const a = model(e.target);
        handler(e, a[0], a[1]);
      });
    },
    spread(node, accessor) {
      wrap(function() {
        const props = accessor();
        let info;
        for (const prop in props) {
          const value = props[prop];
          if (prop === 'style') {
            Object.assign(node.style, value);
          } else if (prop === 'classList') {
            for (const className in value) node.classList.toggle(className, value[className]);
          } else if (info = Attributes[prop]) {
            if (info.type === 'attribute') {
              node.setAttribute(prop, value)
            } else node[info.alias] = value;
          } else node[prop] = value;
        }
      });
    }
  }, options);
}
