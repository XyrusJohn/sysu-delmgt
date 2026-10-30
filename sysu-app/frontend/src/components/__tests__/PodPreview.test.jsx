import React from 'react';
import { render } from '@testing-library/react';
import PodPreview from '../PodPreview';

describe('PodPreview', () => {
  test('renders with image', () => {
    const { container } = render(
      <PodPreview
        imageUrl="https://example.com/image.jpg"
        capturedAt={new Date('2023-01-01T12:00:00Z')}
      />
    );
    expect(container).toMatchSnapshot();
  });

  test('renders without image', () => {
    const { container } = render(
      <PodPreview
        imageUrl=""
        capturedAt={new Date('2023-01-01T12:00:00Z')}
      />
    );
    expect(container).toMatchSnapshot();
  });

  test('renders with different date', () => {
    const { container } = render(
      <PodPreview
        imageUrl="https://example.com/image2.jpg"
        capturedAt="2023-12-31T23:59:59Z"
      />
    );
    expect(container).toMatchSnapshot();
  });
});
