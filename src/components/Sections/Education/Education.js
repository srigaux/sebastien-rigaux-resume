import React from 'react';
import { StaticQuery, graphql } from 'gatsby';
import EducationItem from './EducationItem';
import Timeline from '../../Timeline';
import Section from '../Section';

const Education = () => (
  <StaticQuery
    query={graphql`
      query {
        allMarkdownRemark(
          filter: { fields: { sourceName: { eq: "educations" } } }
          sort: { fields: frontmatter___date, order: DESC }
        ) {
          edges {
            node {
              id
              html
              frontmatter {
                institution
                studyType
                area
                gpa
                date
              }
            }
          }
        }
      }
    `}
    render={data => (
      <Section id="education" title="Education">
        <Timeline>
          {data.allMarkdownRemark.edges.map(
            ({
              node: {
                id,
                html,
                frontmatter: { institution, studyType, area, gpa, date },
              },
            }) => (
              <EducationItem
                key={id}
                institution={institution}
                studyType={studyType}
                area={area}
                description={html}
                gpa={gpa}
                date={date}
              />
            )
          )}
        </Timeline>
      </Section>
    )}
  />
);

export default Education;
