import React, { useState } from 'react';

const FIELDS = [
  'title',
  'subtitle',
  'description',
  'category',
  'tags',
  'owner',
  'status',
  'priority',
  'dueDate',
  'notes',
];

const SAMPLES = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.',
];

function buildSchema() {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    rows.push({
      id: i,
      name: `field-${i}`,
      label: `Editor field ${i}`,
      placeholder: SAMPLES[i % SAMPLES.length],
      help: `Help text for field ${i}: ${SAMPLES[(i + 1) % SAMPLES.length]}`,
    });
  }
  return rows;
}

const SCHEMA = buildSchema();

export default function EditorPanel() {
  const [values, setValues] = useState(() => {
    const initial = {};
    for (const field of FIELDS) {
      initial[field] = '';
    }
    for (const row of SCHEMA) {
      initial[row.name] = '';
    }
    return initial;
  });

  const update = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  return React.createElement(
    'div',
    null,
    React.createElement('h3', null, 'Editor'),
    FIELDS.map((field) =>
      React.createElement(
        'label',
        { key: field, style: { display: 'block' } },
        field,
        React.createElement('input', {
          value: values[field] || '',
          onChange: (e) => update(field, e.target.value),
        })
      )
    ),
    SCHEMA.map((row) =>
      React.createElement(
        'label',
        { key: row.id, style: { display: 'block' } },
        row.label,
        React.createElement('input', {
          placeholder: row.placeholder,
          value: values[row.name] || '',
          onChange: (e) => update(row.name, e.target.value),
        })
      )
    )
  );
}
