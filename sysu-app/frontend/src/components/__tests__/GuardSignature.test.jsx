import React from 'react';
import { render } from '@testing-library/react';
import GuardSignature from '../GuardSignature';

describe('GuardSignature', () => {
  test('renders with verified signature', () => {
    const { container } = render(
      <GuardSignature
        firstName="John"
        lastName="Doe"
        mi="A"
        signatureBase64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        verified={true}
      />
    );
    expect(container).toMatchSnapshot();
  });

  test('renders with unverified signature', () => {
    const { container } = render(
      <GuardSignature
        firstName="Jane"
        lastName="Smith"
        mi=""
        signatureBase64=""
        verified={false}
      />
    );
    expect(container).toMatchSnapshot();
  });

  test('renders without middle initial', () => {
    const { container } = render(
      <GuardSignature
        firstName="John"
        lastName="Doe"
        mi=""
        signatureBase64="somebase64"
        verified={true}
      />
    );
    expect(container).toMatchSnapshot();
  });
});
