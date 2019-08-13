import React from 'react';
import { useStaticQuery, graphql } from 'gatsby';
import ExperienceItem from './ExperienceItem';
import Timeline from '../../Timeline';
import Section from '../Section';

const Experience = () => {
  const data = useStaticQuery(graphql`
    query {
      allMarkdownRemark(
        filter: { fields: { sourceName: { eq: "experiences" } } }
        sort: { fields: frontmatter___date, order: DESC }
      ) {
        edges {
          node {
            id
            html
            frontmatter {
              title
              date
              company
            }
          }
        }
      }
    }
  `);

  return (
    <Section id="experience" title="Experience Professionnelle">
      <Timeline>
        {data.allMarkdownRemark.edges.map(
          ({
            node: {
              id,
              html,
              frontmatter: { title, date, company },
            },
          }) => (
            <ExperienceItem
              key={id}
              company={company}
              date={date}
              title={title}
              description={html}
            />
          )
        )}
      </Timeline>
    </Section>
  );
};

export default Experience;
